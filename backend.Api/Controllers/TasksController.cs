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

        return Ok(await tasks.OrderBy(t => t.DueDate).Select(t => new TaskDto(
            t.Id, t.Title, t.AssignedToId, t.AssignedTo == null ? null : t.AssignedTo.FullName,
            t.Status, t.DueDate, t.Priority, t.ReviewedAt)).ToListAsync());
    }

    [HttpPost, Authorize(Roles = "Manager")]
    public async Task<IActionResult> Create(int projectId, TaskCreateDto dto)
    {
        if (!await db.Projects.VisibleTo(User).AnyAsync(p => p.Id == projectId)) return NotFound();
        if (string.IsNullOrWhiteSpace(dto.Title)) return BadRequest("Task title is required");
        if (!Enum.IsDefined(dto.Priority)) return BadRequest("Invalid task priority");
        if (dto.AssignedToId.HasValue &&
            !await db.ProjectMembers.AnyAsync(m => m.ProjectId == projectId &&
                m.UserId == dto.AssignedToId.Value &&
                m.User.Role == UserRole.Employee &&
                m.User.IsActive))
            return BadRequest("Assignee must be an active employee in this project");

        var task = new ProjectTask
        {
            ProjectId = projectId,
            Title = dto.Title.Trim(),
            AssignedToId = dto.AssignedToId,
            DueDate = dto.DueDate,
            Priority = dto.Priority
        };
        db.ProjectTasks.Add(task);
        db.History.Add(new ProjectHistory
        {
            ProjectId = projectId,
            PerformedById = User.UserId(),
            Action = $"Task '{task.Title}' created"
        });
        await db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetAll), new { projectId }, new { task.Id });
    }

    [HttpPut("{taskId}/status"), Authorize(Roles = "Manager,Employee")]
    public async Task<IActionResult> UpdateStatus(int projectId, int taskId, TaskStatusDto dto)
    {
        if (!await db.Projects.VisibleTo(User).AnyAsync(p => p.Id == projectId)) return NotFound();
        if (!Enum.IsDefined(dto.Status)) return BadRequest("Invalid task status");

        var task = await db.ProjectTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.ProjectId == projectId);
        if (task is null) return NotFound();

        if (User.IsInRole(nameof(UserRole.Employee)))
        {
            if (task.AssignedToId != User.UserId()) return Forbid();
            if (task.Status == WorkStatus.Completed) return Conflict("Completed tasks cannot be reopened");
            if (task.Status == WorkStatus.InReview && dto.Status != WorkStatus.InReview)
                return Conflict("The task is waiting for manager review");
            if (dto.Status == WorkStatus.Completed)
                return BadRequest("Only a project manager can approve a task");
            if (dto.Status == WorkStatus.InReview && task.Status != WorkStatus.InProgress)
                return BadRequest("Move the task to In Progress before submitting it for review");
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
            PerformedById = User.UserId(),
            Action = $"Task '{task.Title}' status changed to {dto.Status}"
        });
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPut("{taskId}/review"), Authorize(Roles = "Manager")]
    public async Task<IActionResult> Review(int projectId, int taskId, TaskReviewDto dto)
    {
        if (!await db.Projects.VisibleTo(User).AnyAsync(p => p.Id == projectId)) return NotFound();
        if (dto.Comment?.Length > 2000) return BadRequest("Review note must be 2000 characters or fewer");
        var task = await db.ProjectTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.ProjectId == projectId);
        if (task is null) return NotFound();
        if (task.Status != WorkStatus.InReview) return Conflict("Only tasks in review can be approved or rejected");

        task.Status = dto.Approve ? WorkStatus.Completed : WorkStatus.InProgress;
        task.ReviewedById = User.UserId();
        task.ReviewedAt = DateTime.UtcNow;

        var reviewAction = dto.Approve ? "approved" : "returned for changes";
        db.History.Add(new ProjectHistory
        {
            ProjectId = projectId,
            PerformedById = User.UserId(),
            Action = $"Task '{task.Title}' {reviewAction}"
        });

        if (!string.IsNullOrWhiteSpace(dto.Comment))
        {
            db.TaskComments.Add(new TaskComment
            {
                TaskId = task.Id,
                AuthorId = User.UserId(),
                Content = dto.Comment.Trim()
            });
        }

        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("{taskId}/comments")]
    public async Task<IActionResult> GetComments(int projectId, int taskId)
    {
        if (!await db.Projects.VisibleTo(User).AnyAsync(p => p.Id == projectId)) return NotFound();
        if (!await db.ProjectTasks.AnyAsync(t => t.Id == taskId && t.ProjectId == projectId)) return NotFound();

        var comments = await db.TaskComments.Where(c => c.TaskId == taskId)
            .OrderBy(c => c.CreatedAt)
            .Select(c => new TaskCommentDto(c.Id, c.AuthorId, c.Author.FullName, c.Content, c.CreatedAt))
            .ToListAsync();
        return Ok(comments);
    }

    [HttpPost("{taskId}/comments")]
    public async Task<IActionResult> AddComment(int projectId, int taskId, TaskCommentCreateDto dto)
    {
        if (!await db.Projects.VisibleTo(User).AnyAsync(p => p.Id == projectId)) return NotFound();
        if (!await db.ProjectTasks.AnyAsync(t => t.Id == taskId && t.ProjectId == projectId)) return NotFound();
        if (string.IsNullOrWhiteSpace(dto.Content) || dto.Content.Length > 2000)
            return BadRequest("Comment must be between 1 and 2000 characters");

        var comment = new TaskComment
        {
            TaskId = taskId,
            AuthorId = User.UserId(),
            Content = dto.Content.Trim()
        };
        db.TaskComments.Add(comment);
        await db.SaveChangesAsync();
        return Ok();
    }
}
