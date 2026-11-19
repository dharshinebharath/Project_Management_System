using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using backend.Api.Data;
using backend.Api.DTOs;
using backend.Api.Helpers;
using backend.Api.Models;

namespace backend.Api.Controllers;

[ApiController, Route("api/projects/{projectId}/files"), Authorize]
public class FilesController(AppDbContext db, IWebHostEnvironment env) : ControllerBase
{
    private string Folder => Path.Combine(env.ContentRootPath, "Uploads");

    [HttpGet]
    public async Task<IActionResult> List(int projectId)
    {
        if (!await db.Projects.VisibleTo(User).AnyAsync(p => p.Id == projectId)) return NotFound();
        return Ok(await db.Files.Where(f => f.ProjectId == projectId).OrderByDescending(f => f.UploadedAt)
            .Select(f => new FileDto(f.Id, f.FileName, f.Size, f.UploadedBy.FullName, f.UploadedAt)).ToListAsync());
    }

    [HttpPost, Authorize(Roles = "Admin,Manager"), RequestSizeLimit(25_000_000)]
    public async Task<IActionResult> Upload(int projectId, IFormFile file)
    {
        if (!await db.Projects.VisibleTo(User).AnyAsync(p => p.Id == projectId)) return NotFound();
        if (file.Length == 0) return BadRequest("Empty file");

        Directory.CreateDirectory(Folder);
        var stored = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        await using (var fs = System.IO.File.Create(Path.Combine(Folder, stored)))
            await file.CopyToAsync(fs);

        db.Files.Add(new ProjectFile
        {
            ProjectId = projectId,
            FileName = Path.GetFileName(file.FileName),
            StoredName = stored,
            ContentType = file.ContentType,
            Size = file.Length,
            UploadedById = User.UserId()
        });
        db.History.Add(new ProjectHistory
        {
            ProjectId = projectId,
            PerformedById = User.UserId(),
            Action = $"File '{file.FileName}' uploaded"
        });
        await db.SaveChangesAsync();
        return Ok();
    }

    [HttpGet("{fileId}/download")]
    public async Task<IActionResult> Download(int projectId, int fileId)
    {
        if (!await db.Projects.VisibleTo(User).AnyAsync(p => p.Id == projectId)) return NotFound();
        var f = await db.Files.FirstOrDefaultAsync(x => x.Id == fileId && x.ProjectId == projectId);
        if (f is null) return NotFound();
        var path = Path.Combine(Folder, f.StoredName);
        return System.IO.File.Exists(path) ? PhysicalFile(path, f.ContentType, f.FileName) : NotFound();
    }
}