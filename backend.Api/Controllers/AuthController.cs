using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using backend.Api.Data;
using backend.Api.DTOs;
using backend.Api.Services;

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
}