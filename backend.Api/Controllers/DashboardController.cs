using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using backend.Api.Data;
using backend.Api.DTOs;
using backend.Api.Helpers;
using backend.Api.Models;

namespace backend.Api.Controllers;

[ApiController, Route("api/[controller]"), Authorize]
public class DashboardController(AppDbContext db) : ControllerBase
{
    // Pie chart: how many projects are Active / Completed / OnHold
    [HttpGet("summary")]
    public async Task<IActionResult> Summary()
    {
        var groups = await db.Projects.VisibleTo(User).GroupBy(p => p.Status)
            .Select(g => new { g.Key, Count = g.Count() }).ToListAsync();

        var chart = Enum.GetValues<ProjectStatus>()
            .Select(s => new ChartItem(s.ToString(), groups.FirstOrDefault(g => g.Key == s)?.Count ?? 0));

        var visibleProjectIds = db.Projects.VisibleTo(User).Select(p => p.Id);
        var taskQuery = db.ProjectTasks.Where(t => visibleProjectIds.Contains(t.ProjectId));
        if (User.IsInRole(nameof(UserRole.Employee)))
            taskQuery = taskQuery.Where(t => t.AssignedToId == User.UserId());
        else if (User.IsInRole(nameof(UserRole.TeamLead)))
            taskQuery = taskQuery.Where(t => t.Team != null && t.Team.TeamLeadId == User.UserId());
        var taskGroups = await taskQuery.GroupBy(t => t.Status)
            .Select(g => new { g.Key, Count = g.Count() }).ToListAsync();
        var taskChart = Enum.GetValues<WorkStatus>()
            .Select(s => new ChartItem(s.ToString(), taskGroups.FirstOrDefault(g => g.Key == s)?.Count ?? 0));

        var users = User.IsInRole("Admin")
            ? await db.Users.CountAsync(u => u.IsActive && u.Role != UserRole.Admin)
            : (int?)null;
        var projectManagers = User.IsInRole("Admin")
            ? await db.Users.CountAsync(user => user.Role == UserRole.Manager && user.IsActive)
            : (int?)null;

        return Ok(new
        {
            projectsByStatus = chart,
            tasksByStatus = taskChart,
            totalUsers = users,
            totalProjectManagers = projectManagers
        });
    }

    [HttpGet("team-lead"), Authorize(Roles = "TeamLead")]
    public async Task<IActionResult> TeamLead()
    {
        var userId = User.UserId();
        var projectIds = db.Projects.VisibleTo(User).Where(project => project.Status == ProjectStatus.Active)
            .Select(project => project.Id);
        var teams = db.Teams.Where(team => team.TeamLeadId == userId && projectIds.Contains(team.ProjectId));
        var teamIds = teams.Select(team => team.Id);
        var tasks = db.ProjectTasks.Where(task => task.TeamId.HasValue && teamIds.Contains(task.TeamId.Value));
        var today = DateTime.UtcNow;

        return Ok(new
        {
            totalTeamMembers = await db.TeamMembers.Where(member => teamIds.Contains(member.TeamId))
                .Select(member => member.UserId).Distinct().CountAsync(),
            totalTasks = await tasks.CountAsync(),
            pendingTasks = await tasks.CountAsync(task => task.Status == WorkStatus.Todo),
            inProgressTasks = await tasks.CountAsync(task => task.Status == WorkStatus.InProgress),
            reviewTasks = await tasks.CountAsync(task => task.Status == WorkStatus.InReview),
            completedTasks = await tasks.CountAsync(task => task.Status == WorkStatus.Completed),
            overdueTasks = await tasks.CountAsync(task => task.DueDate < today &&
                task.Status != WorkStatus.Completed)
        });
    }

    // Pie chart: task breakdown for one project + overall progress
    [HttpGet("project/{id}")]
    public async Task<IActionResult> Project(int id)
    {
        if (!await db.Projects.VisibleTo(User).AnyAsync(p => p.Id == id)) return NotFound();

        var projectTasks = db.ProjectTasks.Where(t => t.ProjectId == id);
        if (User.IsInRole(nameof(UserRole.TeamLead)))
            projectTasks = projectTasks.Where(task =>
                task.Team != null && task.Team.TeamLeadId == User.UserId());
        else if (User.IsInRole(nameof(UserRole.Employee)))
            projectTasks = projectTasks.Where(task => task.AssignedToId == User.UserId());
        var groups = await projectTasks
            .GroupBy(t => t.Status).Select(g => new { g.Key, Count = g.Count() }).ToListAsync();

        var tasks = Enum.GetValues<WorkStatus>()
            .Select(s => new ChartItem(s.ToString(), groups.FirstOrDefault(g => g.Key == s)?.Count ?? 0)).ToList();

        var total = tasks.Sum(t => t.Value);
        var done = tasks.First(t => t.Label == nameof(WorkStatus.Completed)).Value;

        return Ok(new
        {
            tasksByStatus = tasks,
            progress = total == 0 ? 0 : done * 100 / total,
            memberCount = User.IsInRole(nameof(UserRole.TeamLead))
                ? await db.TeamMembers.CountAsync(member =>
                    member.Team.ProjectId == id && member.Team.TeamLeadId == User.UserId())
                : await db.ProjectMembers.CountAsync(m => m.ProjectId == id),
            fileCount = await db.Files.VisibleTo(User).CountAsync(f => f.ProjectId == id)
        });
    }
}
