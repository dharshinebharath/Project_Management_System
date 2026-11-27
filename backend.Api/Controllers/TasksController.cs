using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using backend.Api.Data;
using backend.Api.DTOs;
using backend.Api.Helpers;
using backend.Api.Models;

namespace backend.Api.Controllers;

[ApiController, Route("api/projects/{projectId}/tasks"), Authorize]
public class TasksController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetAll(int projectId)
    {
        if (!await db.Projects.VisibleTo(User).AnyAsync(p => p.Id == projectId)) return NotFound();

        var tasks = db.ProjectTasks.Where(t => t.ProjectId == projectId);
        if (User.IsInRole(nameof(UserRole.Employee)))
            tasks = tasks.Where(t => t.AssignedToId == User.UserId());
        else if (User.IsInRole(nameof(UserRole.TeamLead)))
            tasks = tasks.Where(t => t.Team != null && t.Team.TeamLeadId == User.UserId());

        return Ok(await tasks.OrderBy(t => t.DueDate).Select(t => new TaskDto(
            t.Id, t.Title, t.AssignedToId, t.AssignedTo == null ? null : t.AssignedTo.FullName,
            t.Status, t.DueDate, t.Priority, t.ReviewedAt, t.TeamId,
            t.Team == null ? null : t.Team.Name, t.Description, t.StartDate)).ToListAsync());
    }

    [HttpPost, Authorize(Roles = "TeamLead")]
    public async Task<IActionResult> Create(int projectId, TaskCreateDto dto)
    {
        await using var transaction = await db.BeginUpdateAsync();
        if (!await db.Projects.VisibleTo(User).AnyAsync(p => p.Id == projectId && p.Status == ProjectStatus.Active))
            return NotFound();
        if (string.IsNullOrWhiteSpace(dto.Title)) return BadRequest("Task title is required");
        if (!dto.DueDate.HasValue) return BadRequest("Task deadline is required");
        if (dto.StartDate > DateOnly.FromDateTime(dto.DueDate.Value))
            return BadRequest("The deadline must be on or after the start date");
        if (dto.Description?.Length > 5000) return BadRequest("Task description must be 5000 characters or fewer");
        if (!Enum.IsDefined(dto.Priority)) return BadRequest("Invalid task priority");
        if (!dto.AssignedToId.HasValue) return BadRequest("Select a task assignee");
        var leadId = User.UserId();
        var assigneeId = dto.AssignedToId.Value;
        var teams = db.Teams.Where(team => team.ProjectId == projectId && team.TeamLeadId == leadId);
        if (dto.TeamId.HasValue) teams = teams.Where(team => team.Id == dto.TeamId);
        if (assigneeId != leadId)
            teams = teams.Where(team => team.Members.Any(member => member.UserId == assigneeId &&
                member.User.Role == UserRole.Employee && member.User.IsActive));
        var teamId = await teams.OrderBy(team => team.Id).Select(team => (int?)team.Id).FirstOrDefaultAsync();
        if (teamId is null)
            return BadRequest("Select yourself or an active employee on one of your teams");

        var task = new ProjectTask
        {
            ProjectId = projectId,
            Title = dto.Title.Trim(),
            Description = string.IsNullOrWhiteSpace(dto.Description) ? null : dto.Description.Trim(),
            AssignedToId = dto.AssignedToId,
            AssignedById = User.UserId(),
            TeamId = teamId,
            StartDate = dto.StartDate,
            DueDate = dto.DueDate,
            Priority = dto.Priority
        };
        db.ProjectTasks.Add(task);
        db.History.Add(new ProjectHistory
        {
            ProjectId = projectId,
            TeamId = task.TeamId,
            PerformedById = User.UserId(),
            Action = $"Task '{task.Title}' created"
        });
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return CreatedAtAction(nameof(GetAll), new { projectId }, new { task.Id });
    }

    [HttpPut("{taskId}/status"), Authorize(Roles = "Manager,TeamLead,Employee")]
    public async Task<IActionResult> UpdateStatus(int projectId, int taskId, TaskStatusDto dto)
    {
        if (!await db.Projects.VisibleTo(User).AnyAsync(p => p.Id == projectId && p.Status == ProjectStatus.Active))
            return NotFound();
        if (!Enum.IsDefined(dto.Status)) return BadRequest("Invalid task status");

        var task = await db.ProjectTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.ProjectId == projectId);
        if (task is null) return NotFound();

        if (!User.IsInRole(nameof(UserRole.Manager)))
        {
            if (task.AssignedToId != User.UserId()) return Forbid();
            if (task.Status == WorkStatus.Completed) return Conflict("Completed tasks cannot be reopened");
            if (task.Status == WorkStatus.InReview && dto.Status != WorkStatus.InReview)
                return Conflict("The task is waiting for review");
            if (task.Status == WorkStatus.Todo && dto.Status != WorkStatus.InProgress)
                return BadRequest("Start a task before changing its status");
            if (dto.Status == WorkStatus.InReview && task.Status != WorkStatus.InProgress)
                return BadRequest("Move the task to In Progress before submitting it for review");
            if (task.Status == WorkStatus.InProgress && dto.Status != WorkStatus.InReview)
                return BadRequest("Submit an in-progress task for review");
        }
        else if (dto.Status is WorkStatus.InReview or WorkStatus.Completed)
        {
            return BadRequest("Use the review endpoint to approve a task");
        }
        else if (task.Status == WorkStatus.Completed && dto.Status != WorkStatus.Completed)
        {
            return Conflict("Completed tasks cannot be reopened");
        }

        task.Status = dto.Status;
        if (dto.Status != WorkStatus.InReview)
        {
            task.ReviewedById = null;
            task.ReviewedAt = null;
        }
        db.History.Add(new ProjectHistory
        {
            ProjectId = projectId,
            TeamId = task.TeamId,
            PerformedById = User.UserId(),
            Action = $"Task '{task.Title}' status changed to {dto.Status}"
        });
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPut("{taskId}/review"), Authorize(Roles = "Manager,TeamLead")]
    public async Task<IActionResult> Review(int projectId, int taskId, TaskReviewDto dto)
    {
        if (!await db.Projects.VisibleTo(User).AnyAsync(p => p.Id == projectId && p.Status == ProjectStatus.Active))
            return NotFound();
        var task = await db.ProjectTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.ProjectId == projectId);
        if (task is null) return NotFound();
        if (User.IsInRole(nameof(UserRole.TeamLead)))
        {
            if (!await db.Teams.AnyAsync(team => team.Id == task.TeamId &&
                    team.TeamLeadId == User.UserId()))
                return Forbid();
            if (task.AssignedToId == User.UserId()) return Forbid();
        }
        if (task.Status != WorkStatus.InReview) return Conflict("Only tasks in review can be approved or rejected");

        task.Status = dto.Approve ? WorkStatus.Completed : WorkStatus.InProgress;
        task.ReviewedById = User.UserId();
        task.ReviewedAt = DateTime.UtcNow;

        var reviewAction = dto.Approve ? "approved" : "returned for changes";
        db.History.Add(new ProjectHistory
        {
            ProjectId = projectId,
            TeamId = task.TeamId,
            PerformedById = User.UserId(),
            Action = $"Task '{task.Title}' {reviewAction}"
        });

        await db.SaveChangesAsync();
        return NoContent();
    }
}
