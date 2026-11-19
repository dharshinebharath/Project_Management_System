namespace backend.Api.DTOs;

public record RegisterDto(
    string FullName,
    string Email,
    string Password,
    string Designation
);