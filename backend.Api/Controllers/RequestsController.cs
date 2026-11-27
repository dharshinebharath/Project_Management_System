using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using backend.Api.Data;
using backend.Api.DTOs;
using backend.Api.Helpers;
using backend.Api.Models;

namespace backend.Api.Controllers;

[ApiController, Route("api/[controller]"), Authorize]
public class RequestsController(AppDbContext db) : ControllerBase
{
    [HttpGet, Authorize(Roles = "Admin,Manager")]
    public async Task<IActionResult> GetAll()
    {
        var q = db.Requests.AsQueryable();
        if (User.IsInRole("Manager")) q = q.Where(r => r.RequestedById == User.UserId());

        return Ok(await q.OrderByDescending(r => r.CreatedAt).Select(r => new RequestDto(
            r.Id, r.ProjectId, r.Project.Name, r.EmployeeId, r.Employee.FullName,
            r.RequestedBy.FullName, r.Note, r.Status, r.CreatedAt)).ToListAsync());
    }

    [HttpPost, Authorize(Roles = "Manager")]
    public async Task<IActionResult> Create(RequestCreateDto dto)
    {
        var me = User.UserId();
        if (!await db.Projects.AnyAsync(p => p.Id == dto.ProjectId && p.ManagerId == me &&
                p.Status == ProjectStatus.Active))
            return Forbid();
        if (!await db.Users.AnyAsync(u => u.Id == dto.EmployeeId && u.Role == UserRole.Employee && u.IsActive))
            return BadRequest("Invalid employee");
        if (await db.ProjectMembers.AnyAsync(m => m.ProjectId == dto.ProjectId && m.UserId == dto.EmployeeId))
            return Conflict("Employee already in this project");
        if (await db.Requests.AnyAsync(r => r.ProjectId == dto.ProjectId && r.EmployeeId == dto.EmployeeId
                                            && r.Status == RequestStatus.Pending))
            return Conflict("A pending request already exists");

        db.Requests.Add(new TeamRequest
        {
            ProjectId = dto.ProjectId,
            EmployeeId = dto.EmployeeId,
            RequestedById = me,
            Note = dto.Note
        });
        await db.SaveChangesAsync();
        return Ok();
    }

    [HttpPut("{id}/review"), Authorize(Roles = "Admin")]
    public async Task<IActionResult> Review(int id, RequestReviewDto dto)
    {
        await using var transaction = await db.BeginUpdateAsync();
        var r = await db.Requests.Include(x => x.Employee).Include(x => x.Project)
            .FirstOrDefaultAsync(x => x.Id == id);
        if (r is null) return NotFound();
        if (r.Status != RequestStatus.Pending) return BadRequest("Already reviewed");

        r.Status = dto.Approve ? RequestStatus.Approved : RequestStatus.Rejected;
        r.ReviewedAt = DateTime.UtcNow;

        if (dto.Approve)
        {
            if (r.Project.Status != ProjectStatus.Active || !r.Employee.IsActive ||
                r.Employee.Role != UserRole.Employee)
                return Conflict("Approval requires an active project and employee");
            if (await db.EmployeesHaveOtherActiveProject(r.ProjectId, [r.EmployeeId]))
                return Conflict("This employee already belongs to another active project");
            if (await db.ProjectMembers.AnyAsync(member => member.ProjectId == r.ProjectId &&
                    member.UserId == r.EmployeeId))
                return Conflict("Employee already in this project");
            db.ProjectMembers.Add(new ProjectMember { ProjectId = r.ProjectId, UserId = r.EmployeeId });
            db.History.Add(new ProjectHistory
            {
                ProjectId = r.ProjectId,
                PerformedById = User.UserId(),
                Action = $"{r.Employee.FullName} added to the project (request approved)"
            });
        }
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return NoContent();
    }
}
