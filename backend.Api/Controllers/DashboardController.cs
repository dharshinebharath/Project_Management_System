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
        var taskGroups = await taskQuery.GroupBy(t => t.Status)
            .Select(g => new { g.Key, Count = g.Count() }).ToListAsync();
        var taskChart = Enum.GetValues<WorkStatus>()
            .Select(s => new ChartItem(s.ToString(), taskGroups.FirstOrDefault(g => g.Key == s)?.Count ?? 0));

        var users = User.IsInRole("Admin") ? await db.Users.CountAsync(u => u.IsActive) : (int?)null;

        return Ok(new { projectsByStatus = chart, tasksByStatus = taskChart, totalUsers = users });
    }

    // Pie chart: task breakdown for one project + overall progress
    [HttpGet("project/{id}")]
    public async Task<IActionResult> Project(int id)
    {
        if (!await db.Projects.VisibleTo(User).AnyAsync(p => p.Id == id)) return NotFound();

        var groups = await db.ProjectTasks.Where(t => t.ProjectId == id)
            .GroupBy(t => t.Status).Select(g => new { g.Key, Count = g.Count() }).ToListAsync();

        var tasks = Enum.GetValues<WorkStatus>()
            .Select(s => new ChartItem(s.ToString(), groups.FirstOrDefault(g => g.Key == s)?.Count ?? 0)).ToList();

        var total = tasks.Sum(t => t.Value);
        var done = tasks.First(t => t.Label == nameof(WorkStatus.Completed)).Value;

        return Ok(new
        {
            tasksByStatus = tasks,
            progress = total == 0 ? 0 : done * 100 / total,
            memberCount = await db.ProjectMembers.CountAsync(m => m.ProjectId == id),
            fileCount = await db.Files.CountAsync(f => f.ProjectId == id)
        });
    }
}