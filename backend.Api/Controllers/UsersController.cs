using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using System.Text;
using backend.Api.Data;
using backend.Api.DTOs;
using backend.Api.Models;

namespace backend.Api.Controllers;

[ApiController, Route("api/[controller]"), Authorize]
public class UsersController(AppDbContext db) : ControllerBase
{
    [HttpGet, Authorize(Roles = "Admin")]
    public async Task<IActionResult> GetAll() =>
        Ok(await db.Users.OrderBy(u => u.FullName)
            .Select(u => new UserDto(u.Id, u.FullName, u.Email, u.Role, u.Designation, u.IsActive))
            .ToListAsync());

    // Managers use this list when adding employees to a project
    [HttpGet("employees"), Authorize(Roles = "Admin,Manager")]
    public async Task<IActionResult> Employees() =>
        Ok(await db.Users.Where(u => u.Role == UserRole.Employee && u.IsActive)
            .Select(u => new UserDto(u.Id, u.FullName, u.Email, u.Role, u.Designation, u.IsActive))
            .ToListAsync());

    [HttpGet("managers"), Authorize(Roles = "Admin")]
    public async Task<IActionResult> Managers() =>
        Ok(await db.Users.Where(u => u.Role == UserRole.Manager && u.IsActive)
            .Select(u => new UserDto(u.Id, u.FullName, u.Email, u.Role, u.Designation, u.IsActive))
            .ToListAsync());

    [HttpGet("team-leads"), Authorize(Roles = "Admin,Manager")]
    public async Task<IActionResult> TeamLeads() =>
        Ok(await db.Users.Where(u => u.Role == UserRole.TeamLead && u.IsActive)
            .OrderBy(u => u.FullName)
            .Select(u => new UserDto(u.Id, u.FullName, u.Email, u.Role, u.Designation, u.IsActive))
            .ToListAsync());

    [HttpPost, Authorize(Roles = "Admin")]
    public async Task<IActionResult> Create(UserCreateDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.FullName) || string.IsNullOrWhiteSpace(dto.Email))
            return BadRequest("Full name and email are required");
        if (string.IsNullOrWhiteSpace(dto.Password) || dto.Password.Length < 8 || Encoding.UTF8.GetByteCount(dto.Password) > 72)
            return BadRequest("Use at least 8 characters and at most 72 UTF-8 bytes for the password");
        if (dto.Role is not (UserRole.Manager or UserRole.Employee or UserRole.TeamLead))
            return BadRequest("New team members must be Employees, Managers, or Team Leads");

        var email = dto.Email.Trim();
        if (!new EmailAddressAttribute().IsValid(email))
            return BadRequest("Enter a valid email address");
        if (await db.Users.AnyAsync(u => u.Email == email))
            return Conflict("Email already exists");

        var user = new User
        {
            FullName = dto.FullName.Trim(),
            Email = email,
            Role = dto.Role,
            Designation = string.IsNullOrWhiteSpace(dto.Designation) ? null : dto.Designation.Trim(),
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(dto.Password)
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return Ok(new UserDto(user.Id, user.FullName, user.Email, user.Role, user.Designation, user.IsActive));
    }

    [HttpPut("{id}"), Authorize(Roles = "Admin")]
    public async Task<IActionResult> Update(int id, UserUpdateDto dto)
    {
        var user = await db.Users.FindAsync(id);
        if (user is null) return NotFound();
        if (string.IsNullOrWhiteSpace(dto.FullName)) return BadRequest("Full name is required");
        if (!Enum.IsDefined(dto.Role)) return BadRequest("Invalid user role");
        if (!string.IsNullOrEmpty(dto.NewPassword) && (string.IsNullOrWhiteSpace(dto.NewPassword) ||
                dto.NewPassword.Length < 8 || Encoding.UTF8.GetByteCount(dto.NewPassword) > 72))
            return BadRequest("Use at least 8 characters and at most 72 UTF-8 bytes for the password");
        if ((dto.Role != UserRole.TeamLead || !dto.IsActive) &&
            await db.Teams.AnyAsync(team => team.TeamLeadId == id))
            return Conflict("Reassign this Team Lead's teams before changing their role or deactivating the account");
        if (dto.Role != UserRole.Employee &&
            await db.TeamMembers.AnyAsync(member => member.UserId == id))
            return Conflict("Remove this employee from teams before changing their role");
        if (dto.Role != user.Role &&
            await db.ProjectTasks.AnyAsync(task => task.AssignedToId == id &&
                task.Status != WorkStatus.Completed))
            return Conflict("Finish this account's open tasks before changing its role");
        user.FullName = dto.FullName.Trim(); user.Role = dto.Role;
        user.Designation = string.IsNullOrWhiteSpace(dto.Designation) ? null : dto.Designation.Trim();
        user.IsActive = dto.IsActive;
        if (!string.IsNullOrWhiteSpace(dto.NewPassword))
            user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(dto.NewPassword);
        await db.SaveChangesAsync();
        return NoContent();
    }

    // Soft delete keeps project history intact
    [HttpDelete("{id}"), Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var user = await db.Users.FindAsync(id);
        if (user is null) return NotFound();
        if (await db.Teams.AnyAsync(team => team.TeamLeadId == id))
            return Conflict("Reassign this Team Lead's teams before deactivating the account");
        user.IsActive = false;
        await db.SaveChangesAsync();
        return NoContent();
    }
}
