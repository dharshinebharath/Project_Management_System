using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
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

    [HttpPost, Authorize(Roles = "Admin")]
    public async Task<IActionResult> Create(UserCreateDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.FullName) || string.IsNullOrWhiteSpace(dto.Email))
            return BadRequest("Full name and email are required");
        if (string.IsNullOrWhiteSpace(dto.Password) || dto.Password.Length < 8)
            return BadRequest("Password must be at least 8 characters");
        if (dto.Role != UserRole.Manager && dto.Role != UserRole.Employee)
            return BadRequest("New team members must be Employees or Managers");

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
        if (!string.IsNullOrWhiteSpace(dto.NewPassword) && dto.NewPassword.Length < 8)
            return BadRequest("Password must be at least 8 characters");
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
        user.IsActive = false;
        await db.SaveChangesAsync();
        return NoContent();
    }
}