using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using backend.Api.Data;
using backend.Api.DTOs;
using backend.Api.Services;
using backend.Api.Helpers;

namespace backend.Api.Controllers;

[ApiController, Route("api/[controller]")]
public class AuthController(AppDbContext db, JwtService jwt) : ControllerBase
{
    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginDto dto)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == dto.Email && u.IsActive);
        if (user is null || !BCrypt.Net.BCrypt.Verify(dto.Password, user.PasswordHash))
            return Unauthorized("Invalid email or password");

        return Ok(new LoginResult(jwt.Create(user), user.Id, user.FullName, user.Email, user.Role.ToString()));
    }

    [HttpGet("profile"), Authorize]
    public async Task<IActionResult> Profile(CancellationToken cancellationToken)
    {
        var id = User.UserId();
        var profile = await db.Users.Where(user => user.Id == id && user.IsActive)
            .Select(user => new UserDto(user.Id, user.FullName, user.Email, user.Role, user.Designation, user.IsActive))
            .SingleOrDefaultAsync(cancellationToken);
        return profile is null ? NotFound() : Ok(profile);
    }

    [HttpPut("password"), Authorize]
    public async Task<IActionResult> ChangePassword(ChangePasswordDto dto, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(dto.NewPassword) || dto.NewPassword.Length < 8 ||
            Encoding.UTF8.GetByteCount(dto.NewPassword) > 72)
            return BadRequest("Use at least 8 characters and at most 72 UTF-8 bytes");

        var id = User.UserId();
        var account = db.Users.Where(user => user.Id == id && user.IsActive);
        var hash = await account.Select(user => user.PasswordHash).SingleOrDefaultAsync(cancellationToken);
        if (hash is null || string.IsNullOrEmpty(dto.CurrentPassword) ||
            !BCrypt.Net.BCrypt.Verify(dto.CurrentPassword, hash))
            return BadRequest("Current password is incorrect");
        if (dto.CurrentPassword == dto.NewPassword)
            return BadRequest("Choose a different password");

        var newHash = BCrypt.Net.BCrypt.HashPassword(dto.NewPassword);
        var updated = await account
            .Where(user => EF.Functions.Collate(user.PasswordHash, "Latin1_General_100_BIN2") == hash)
            .ExecuteUpdateAsync(setters => setters.SetProperty(user => user.PasswordHash, newHash), cancellationToken);
        return updated == 1 ? NoContent() : Conflict("The account changed. Sign in again and retry.");
    }
}
