using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using backend.Api.Data;
using backend.Api.DTOs;
using backend.Api.Helpers;
using backend.Api.Models;

namespace backend.Api.Controllers;

[ApiController, Route("api/[controller]"), Authorize]
public class ProjectsController(AppDbContext db) : ControllerBase
{
    private void Log(int projectId, string action) =>
        db.History.Add(new ProjectHistory { ProjectId = projectId, Action = action, PerformedById = User.UserId() });

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] ProjectStatus? status)
    {
        var q = db.Projects.VisibleTo(User);
        if (status.HasValue) q = q.Where(p => p.Status == status);
        var userId = User.UserId();
        var isTeamLead = User.IsInRole(nameof(UserRole.TeamLead));
        var isEmployee = User.IsInRole(nameof(UserRole.Employee));

        var list = await q.OrderByDescending(p => p.StartDate).Select(p => new ProjectListDto(
            p.Id, p.Name, p.Status, p.StartDate, p.EndDate, p.Manager.FullName,
            isTeamLead
                ? p.Teams.Where(team => team.TeamLeadId == userId)
                    .SelectMany(team => team.Members).Select(member => member.UserId).Distinct().Count()
                : p.Members.Count,
            (int)(p.Tasks.Where(task => (!isTeamLead || task.Team != null && task.Team.TeamLeadId == userId) &&
                    (!isEmployee || task.AssignedToId == userId))
                .Average(task => task.Status == WorkStatus.Completed ? (double?)100 : 0) ?? 0)
        )).ToListAsync();
        return Ok(list);
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> Get(int id)
    {
        var userId = User.UserId();
        var isTeamLead = User.IsInRole(nameof(UserRole.TeamLead));
        var p = await db.Projects.VisibleTo(User).Where(x => x.Id == id).Select(x => new ProjectDetailDto(
            x.Id, x.Name, x.Description, x.StartDate, x.EndDate, x.Status, x.ManagerId, x.Manager.FullName,
            x.Members.Where(m => !isTeamLead || x.Teams.Any(t => t.TeamLeadId == userId &&
                    t.Members.Any(tm => tm.UserId == m.UserId)))
                .Select(m => new MemberDto(m.UserId, m.User.FullName, m.User.Email,
                    m.User.Designation, m.JoinedAt)).ToList()
        )).FirstOrDefaultAsync();
        return p is null ? NotFound() : Ok(p);
    }

    [HttpGet("{id}/history"), Authorize(Roles = "Admin,Manager,TeamLead,Employee")]
    public async Task<IActionResult> History(int id)
    {
        if (!await db.Projects.VisibleTo(User).AnyAsync(p => p.Id == id)) return NotFound();
        var history = db.History.Where(entry => entry.ProjectId == id);
        var isTeamLead = User.IsInRole(nameof(UserRole.TeamLead));
        if (isTeamLead)
        {
            var leadId = User.UserId();
            history = history.Where(entry => entry.Team == null
                ? entry.PerformedById == leadId || entry.Action.StartsWith("Status changed: ")
                : entry.Team.TeamLeadId == leadId);
        }

        history = history.OrderByDescending(entry => entry.CreatedAt).ThenByDescending(entry => entry.Id);
        if (isTeamLead) history = history.Take(8);
        return Ok(await history.Select(entry => new HistoryDto(
            entry.Id, entry.Action, entry.PerformedBy.FullName, entry.CreatedAt)).ToListAsync());
    }

    [HttpPost, Authorize(Roles = "Admin")]
    public async Task<IActionResult> Create(ProjectSaveDto dto)
    {
        if (!await db.Users.AnyAsync(u => u.Id == dto.ManagerId &&
            u.Role == UserRole.Manager && u.IsActive))
            return BadRequest("Selected user is not an active manager");

        var p = new Project
        {
            Name = dto.Name,
            Description = dto.Description,
            StartDate = dto.StartDate,
            EndDate = dto.EndDate,
            Status = dto.Status,
            ManagerId = dto.ManagerId
        };
        db.Projects.Add(p);
        await db.SaveChangesAsync();
        Log(p.Id, $"Project '{p.Name}' created");
        await db.SaveChangesAsync();
        return Ok(new { p.Id });
    }

    [HttpPut("{id}"), Authorize(Roles = "Admin")]
    public async Task<IActionResult> Update(int id, ProjectSaveDto dto)
    {
        if (!Enum.IsDefined(dto.Status)) return BadRequest("Invalid project status");
        await using var transaction = await db.BeginUpdateAsync();
        var p = await db.Projects.FindAsync(id);
        if (p is null) return NotFound();
        if (!await db.Users.AnyAsync(u => u.Id == dto.ManagerId &&
            u.Role == UserRole.Manager && u.IsActive))
            return BadRequest("Selected user is not an active manager");
        if (p.Status != ProjectStatus.Active && dto.Status == ProjectStatus.Active)
        {
            var employees = await db.ProjectMembers.Where(member => member.ProjectId == id)
                .Select(member => member.UserId)
                .Union(db.TeamMembers.Where(member => member.Team.ProjectId == id).Select(member => member.UserId))
                .ToArrayAsync();
            var leads = await db.Teams.Where(team => team.ProjectId == id)
                .Select(team => team.TeamLeadId).Distinct().ToArrayAsync();
            if (await db.EmployeesHaveOtherActiveProject(id, employees) ||
                await db.LeadsHaveOtherActiveProject(id, leads))
                return Conflict("An employee or Team Lead already belongs to another active project");
        }
        if (p.Status != dto.Status) Log(id, $"Status changed: {p.Status} → {dto.Status}");
        p.Name = dto.Name; p.Description = dto.Description; p.StartDate = dto.StartDate;
        p.EndDate = dto.EndDate; p.Status = dto.Status; p.ManagerId = dto.ManagerId;
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return NoContent();
    }

    [HttpDelete("{id}"), Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var p = await db.Projects.FindAsync(id);
        if (p is null) return NotFound();
        db.Projects.Remove(p);
        await db.SaveChangesAsync();
        return NoContent();
    }

    // Keep the single-member endpoint for existing integrations.
    [HttpPost("{id}/members"), Authorize(Roles = "Admin,Manager")]
    public async Task<IActionResult> AddMember(int id, AddMemberDto dto)
    {
        await using var transaction = await db.BeginUpdateAsync();
        if (!await db.Projects.VisibleTo(User).AnyAsync(p => p.Id == id && p.Status == ProjectStatus.Active))
            return NotFound();
        if (await db.ProjectMembers.AnyAsync(m => m.ProjectId == id && m.UserId == dto.UserId))
            return Conflict("Already a member");
        var emp = await db.Users.FirstOrDefaultAsync(u =>
            u.Id == dto.UserId && u.Role == UserRole.Employee && u.IsActive);
        if (emp is null) return NotFound("Active employee not found");
        if (await db.EmployeesHaveOtherActiveProject(id, [emp.Id]))
            return Conflict("This employee already belongs to another active project");
        db.ProjectMembers.Add(new ProjectMember { ProjectId = id, UserId = dto.UserId });
        Log(id, $"{emp.FullName} added to the project");
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Ok();
    }

    [HttpPost("{id}/members/bulk"), Authorize(Roles = "Manager")]
    public async Task<IActionResult> AddMembers(int id, AddMembersDto dto)
    {
        if (dto.UserIds is null || dto.UserIds.Length == 0)
            return BadRequest("Select at least one employee");
        await using var transaction = await db.BeginUpdateAsync();
        if (!await db.Projects.VisibleTo(User).AnyAsync(p => p.Id == id && p.Status == ProjectStatus.Active))
            return NotFound();

        var userIds = dto.UserIds.Distinct().ToArray();
        var employees = await db.Users
            .Where(u => userIds.Contains(u.Id) && u.Role == UserRole.Employee && u.IsActive)
            .ToListAsync();
        if (employees.Count != userIds.Length)
            return BadRequest("All selected users must be active employees");

        var existingIds = await db.ProjectMembers
            .Where(m => m.ProjectId == id && userIds.Contains(m.UserId))
            .Select(m => m.UserId)
            .ToListAsync();
        var existing = existingIds.ToHashSet();
        var newMembers = employees.Where(employee => !existing.Contains(employee.Id)).ToList();
        if (newMembers.Count == 0)
            return Conflict("All selected employees are already in this project");
        if (await db.EmployeesHaveOtherActiveProject(id, newMembers.Select(employee => employee.Id).ToArray()))
            return Conflict("A selected employee already belongs to another active project");

        db.ProjectMembers.AddRange(newMembers.Select(employee =>
            new ProjectMember { ProjectId = id, UserId = employee.Id }));
        foreach (var employee in newMembers)
            Log(id, $"{employee.FullName} added to the project");

        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Ok(new { addedCount = newMembers.Count });
    }

    [HttpDelete("{id}/members/{userId}"), Authorize(Roles = "Admin,Manager")]
    public async Task<IActionResult> RemoveMember(int id, int userId)
    {
        await using var transaction = await db.BeginUpdateAsync();
        if (!await db.Projects.VisibleTo(User).AnyAsync(p => p.Id == id && p.Status == ProjectStatus.Active))
            return NotFound();
        var m = await db.ProjectMembers.Include(x => x.User)
            .FirstOrDefaultAsync(x => x.ProjectId == id && x.UserId == userId);
        if (m is null) return NotFound();
        if (await db.ProjectTasks.AnyAsync(task => task.ProjectId == id &&
                task.AssignedToId == userId && task.Status != WorkStatus.Completed))
            return Conflict("Reassign the employee's active tasks before removing them");
        var teamMembers = await db.TeamMembers.Where(member =>
            member.Team.ProjectId == id && member.UserId == userId).ToListAsync();
        db.TeamMembers.RemoveRange(teamMembers);
        db.ProjectMembers.Remove(m);
        Log(id, $"{m.User.FullName} removed from the project");
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return NoContent();
    }
}
