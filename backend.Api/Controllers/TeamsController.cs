using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using backend.Api.Data;
using backend.Api.DTOs;
using backend.Api.Helpers;
using backend.Api.Models;

namespace backend.Api.Controllers;

[ApiController, Route("api/projects/{projectId}/teams"), Authorize]
public class TeamsController(AppDbContext db, IWebHostEnvironment env) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetAll(int projectId)
    {
        if (!await db.Projects.VisibleTo(User).AnyAsync(project => project.Id == projectId))
            return NotFound();

        var teams = db.Teams.Where(team => team.ProjectId == projectId);
        if (User.IsInRole(nameof(UserRole.TeamLead)))
            teams = teams.Where(team => team.TeamLeadId == User.UserId());
        else if (User.IsInRole(nameof(UserRole.Employee)))
            teams = teams.Where(team => team.Members.Any(member => member.UserId == User.UserId()));

        var result = await ToTeamDtos(teams).ToListAsync();
        return Ok(result.OrderBy(team => team.Name));
    }

    [HttpGet("~/api/teams/mine")]
    public async Task<IActionResult> Mine()
    {
        var projectIds = db.Projects.VisibleTo(User).Select(project => project.Id);
        var teams = db.Teams.Where(team => projectIds.Contains(team.ProjectId));
        if (User.IsInRole(nameof(UserRole.Manager)))
            teams = teams.Where(team => team.Project.ManagerId == User.UserId());
        else if (User.IsInRole(nameof(UserRole.TeamLead)))
            teams = teams.Where(team => team.TeamLeadId == User.UserId());
        else if (User.IsInRole(nameof(UserRole.Employee)))
            teams = teams.Where(team => team.Members.Any(member => member.UserId == User.UserId()));
        else if (!User.IsInRole(nameof(UserRole.Admin)))
            return Forbid();

        var result = await ToTeamDtos(teams).ToListAsync();
        return Ok(result.OrderBy(team => team.ProjectName).ThenBy(team => team.Name));
    }

    [HttpGet("available-people"), Authorize(Roles = "Manager")]
    public async Task<IActionResult> AvailablePeople(int projectId)
    {
        if (!await db.Projects.VisibleTo(User).AnyAsync(project => project.Id == projectId))
            return NotFound();

        var busyEmployees = db.EmployeesInOtherActiveProjects(projectId);
        var busyLeads = db.LeadsInOtherActiveProjects(projectId);
        var people = await db.Users.Where(user => user.IsActive &&
                ((user.Role == UserRole.Employee && !busyEmployees.Contains(user.Id)) ||
                 (user.Role == UserRole.TeamLead && !busyLeads.Contains(user.Id))))
            .OrderBy(user => user.FullName)
            .Select(user => new UserDto(user.Id, user.FullName, user.Email, user.Role, user.Designation, user.IsActive))
            .ToListAsync();
        return Ok(people);
    }

    [HttpPost, Authorize(Roles = "Manager"), Consumes("application/json")]
    public Task<IActionResult> Create(int projectId, TeamCreateDto dto) =>
        CreateTeam(projectId, dto, []);

    [HttpPost, Authorize(Roles = "Manager"), Consumes("multipart/form-data"), RequestSizeLimit(25_000_000)]
    public Task<IActionResult> CreateWithResources(int projectId, [FromForm] string name,
        [FromForm] int teamLeadId, [FromForm] int[] employeeIds, [FromForm] List<IFormFile> resources) =>
        CreateTeam(projectId, new TeamCreateDto(name, teamLeadId, employeeIds), resources);

    private async Task<IActionResult> CreateTeam(int projectId, TeamCreateDto dto, List<IFormFile> resources)
    {
        if (HasInvalidResources(resources))
            return BadRequest("Choose nonempty resources of up to 20 MB each and up to 24 MB total");
        await using var transaction = await db.BeginUpdateAsync();
        if (!await db.Projects.VisibleTo(User).AnyAsync(project => project.Id == projectId &&
                project.Status == ProjectStatus.Active))
            return NotFound();
        if (string.IsNullOrWhiteSpace(dto.Name) || dto.Name.Trim().Length > 120)
            return BadRequest("Team name must be between 1 and 120 characters");
        if (!await IsActiveTeamLead(dto.TeamLeadId))
            return BadRequest("Select an active Team Lead");
        if (await db.Teams.AnyAsync(team =>
                team.ProjectId == projectId && team.Name == dto.Name.Trim()))
            return Conflict("A team with this name already exists in the project");

        var employeeIds = dto.EmployeeIds.Distinct().ToArray();
        if (!await AreActiveEmployees(employeeIds))
            return BadRequest("All team members must be active employees");
        if (await db.LeadsHaveOtherActiveProject(projectId, [dto.TeamLeadId]) ||
            await db.EmployeesHaveOtherActiveProject(projectId, employeeIds))
            return Conflict("The Team Lead or a selected employee already belongs to another active project");
        await AddProjectMembers(projectId, employeeIds);

        var team = new Team
        {
            ProjectId = projectId,
            Name = dto.Name.Trim(),
            TeamLeadId = dto.TeamLeadId,
            Members = employeeIds.Select(userId => new TeamMember { UserId = userId }).ToList()
        };
        db.Teams.Add(team);
        db.History.Add(new ProjectHistory
        {
            ProjectId = projectId,
            Team = team,
            PerformedById = User.UserId(),
            Action = $"Team '{team.Name}' created"
        });
        await SaveTeam(team, resources, transaction);
        return CreatedAtAction(nameof(GetAll), new { projectId }, new { team.Id });
    }

    [HttpPut("{teamId}"), Authorize(Roles = "Manager"), Consumes("application/json")]
    public Task<IActionResult> Update(int projectId, int teamId, TeamUpdateDto dto) =>
        UpdateTeam(projectId, teamId, dto, []);

    [HttpPut("{teamId}"), Authorize(Roles = "Manager"), Consumes("multipart/form-data"), RequestSizeLimit(25_000_000)]
    public Task<IActionResult> UpdateWithResources(int projectId, int teamId, [FromForm] string name,
        [FromForm] int teamLeadId, [FromForm] int[] employeeIds, [FromForm] List<IFormFile> resources) =>
        UpdateTeam(projectId, teamId, new TeamUpdateDto(name, teamLeadId, employeeIds), resources);

    private async Task<IActionResult> UpdateTeam(int projectId, int teamId, TeamUpdateDto dto, List<IFormFile> resources)
    {
        if (HasInvalidResources(resources))
            return BadRequest("Choose nonempty resources of up to 20 MB each and up to 24 MB total");
        await using var transaction = await db.BeginUpdateAsync();
        if (!await db.Projects.VisibleTo(User).AnyAsync(project => project.Id == projectId &&
                project.Status == ProjectStatus.Active))
            return NotFound();
        var team = await db.Teams.Include(item => item.Members)
            .FirstOrDefaultAsync(item => item.Id == teamId && item.ProjectId == projectId);
        if (team is null) return NotFound();
        if (string.IsNullOrWhiteSpace(dto.Name) || dto.Name.Trim().Length > 120)
            return BadRequest("Team name must be between 1 and 120 characters");
        if (!await IsActiveTeamLead(dto.TeamLeadId))
            return BadRequest("Select an active Team Lead");
        if (await db.Teams.AnyAsync(other => other.ProjectId == projectId &&
                other.Id != teamId && other.Name == dto.Name.Trim()))
            return Conflict("A team with this name already exists in the project");

        var employeeIds = dto.EmployeeIds.Distinct().ToArray();
        var existingIds = team.Members.Select(member => member.UserId).ToHashSet();
        var addedIds = employeeIds.Where(id => !existingIds.Contains(id)).ToArray();
        if (!await AreActiveEmployees(addedIds))
            return BadRequest("New team members must be active employees");
        if ((team.TeamLeadId != dto.TeamLeadId &&
                await db.LeadsHaveOtherActiveProject(projectId, [dto.TeamLeadId])) ||
            await db.EmployeesHaveOtherActiveProject(projectId, addedIds))
            return Conflict("The Team Lead or a selected employee already belongs to another active project");

        var requested = employeeIds.ToHashSet();
        var removedIds = team.Members.Where(member => !requested.Contains(member.UserId))
            .Select(member => member.UserId).ToArray();
        if (removedIds.Length > 0 && await db.ProjectTasks.AnyAsync(task =>
                task.TeamId == teamId && removedIds.Contains(task.AssignedToId ?? 0) &&
                task.Status != WorkStatus.Completed))
            return Conflict("Finish the removed employees' open team tasks before saving this team");
        if (team.TeamLeadId != dto.TeamLeadId && await db.ProjectTasks.AnyAsync(task =>
                task.TeamId == teamId && task.AssignedToId == team.TeamLeadId &&
                task.Status != WorkStatus.Completed))
            return Conflict("Finish the current Team Lead's open team tasks before changing the lead");

        await AddProjectMembers(projectId, addedIds);
        db.TeamMembers.RemoveRange(team.Members.Where(member => !requested.Contains(member.UserId)));
        foreach (var employeeId in addedIds)
            team.Members.Add(new TeamMember { TeamId = teamId, UserId = employeeId });

        team.Name = dto.Name.Trim();
        team.TeamLeadId = dto.TeamLeadId;
        db.History.Add(new ProjectHistory
        {
            ProjectId = projectId,
            TeamId = team.Id,
            PerformedById = User.UserId(),
            Action = $"Team '{team.Name}' updated"
        });
        await SaveTeam(team, resources, transaction);
        return NoContent();
    }

    private static bool HasInvalidResources(List<IFormFile> resources) =>
        resources.Any(file => file.Length is 0 or > 20_000_000) ||
        resources.Sum(file => file.Length) > 24_000_000;

    private async Task SaveTeam(Team team, List<IFormFile> resources, IDbContextTransaction transaction)
    {
        var storedPaths = new List<string>();
        try
        {
            if (resources.Count > 0)
            {
                var folder = Path.Combine(env.ContentRootPath, "Uploads");
                Directory.CreateDirectory(folder);
                foreach (var file in resources)
                {
                    var storedName = Guid.NewGuid().ToString();
                    var path = Path.Combine(folder, storedName);
                    await using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write);
                    storedPaths.Add(path);
                    await file.CopyToAsync(stream, HttpContext.RequestAborted);
                    team.Resources.Add(new ProjectFile
                    {
                        ProjectId = team.ProjectId,
                        FileName = Path.GetFileName(file.FileName),
                        StoredName = storedName,
                        ContentType = string.IsNullOrWhiteSpace(file.ContentType) ? "application/octet-stream" : file.ContentType,
                        Size = file.Length,
                        UploadedById = User.UserId()
                    });
                }
            }
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
        }
        catch
        {
            foreach (var path in storedPaths)
                System.IO.File.Delete(path);
            throw;
        }
    }

    private Task<bool> IsActiveTeamLead(int userId) =>
        db.Users.AnyAsync(user => user.Id == userId &&
            user.Role == UserRole.TeamLead && user.IsActive);

    private async Task<bool> AreActiveEmployees(int[] employeeIds) =>
        await db.Users.CountAsync(user => employeeIds.Contains(user.Id) &&
            user.Role == UserRole.Employee && user.IsActive) == employeeIds.Length;

    private async Task AddProjectMembers(int projectId, int[] employeeIds)
    {
        var existing = await db.ProjectMembers.Where(member => member.ProjectId == projectId &&
            employeeIds.Contains(member.UserId)).Select(member => member.UserId).ToListAsync();
        db.ProjectMembers.AddRange(employeeIds.Except(existing).Select(userId =>
            new ProjectMember { ProjectId = projectId, UserId = userId }));
    }

    private IQueryable<TeamDto> ToTeamDtos(IQueryable<Team> teams)
    {
        var canSeeResources = !User.IsInRole(nameof(UserRole.Employee));
        return teams.Select(team => new TeamDto(
            team.Id,
            team.ProjectId,
            team.Name,
            team.TeamLeadId,
            team.TeamLead.FullName,
            team.Project.Name,
            team.Members.OrderBy(member => member.User.FullName)
                .Select(member => new TeamMemberSummaryDto(member.UserId, member.User.FullName,
                    member.User.Email, member.User.Designation, member.User.IsActive)).ToList(),
            team.Tasks.Count,
            team.Tasks.Count(task => task.Status == WorkStatus.Todo),
            team.Tasks.Count(task => task.Status == WorkStatus.InProgress),
            team.Tasks.Count(task => task.Status == WorkStatus.InReview),
            team.Tasks.Count(task => task.Status == WorkStatus.Completed),
            team.Tasks.Count(task => task.DueDate < DateTime.UtcNow &&
                task.Status != WorkStatus.Completed),
            team.Resources.Where(file => canSeeResources)
                .OrderBy(file => file.FileName)
                .Select(file => new FileDto(file.Id, file.FileName, file.Size,
                    file.UploadedBy.FullName, file.UploadedAt, file.TaskId)).ToList()));
    }
}
