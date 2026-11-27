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
    public async Task<IActionResult> List(int projectId, [FromQuery] int? taskId)
    {
        if (!await db.Projects.VisibleTo(User).AnyAsync(p => p.Id == projectId)) return NotFound();
        var files = db.Files.VisibleTo(User).Where(file => file.ProjectId == projectId);
        if (taskId.HasValue)
            files = files.Where(file => file.TaskId == taskId.Value);

        return Ok(await files.OrderByDescending(file => file.UploadedAt)
            .Select(file => new FileDto(file.Id, file.FileName, file.Size,
                file.UploadedBy.FullName, file.UploadedAt, file.TaskId)).ToListAsync());
    }

    [HttpPost, Authorize(Roles = "Admin,Manager,TeamLead,Employee"), RequestSizeLimit(25_000_000)]
    public async Task<IActionResult> Upload(int projectId, IFormFile file, [FromForm] int? taskId)
    {
        var isAdmin = User.IsInRole(nameof(UserRole.Admin));
        if (!await db.Projects.VisibleTo(User).AnyAsync(p => p.Id == projectId &&
                (isAdmin || p.Status == ProjectStatus.Active)))
            return NotFound();
        if (file is null) return BadRequest("Select a file");
        if (file.Length == 0) return BadRequest("Empty file");
        if (file.Length > 20_000_000) return BadRequest("File must be 20 MB or smaller");

        int? teamId = null;
        if (taskId.HasValue)
        {
            var task = await db.ProjectTasks.Include(item => item.Team)
                .FirstOrDefaultAsync(item => item.Id == taskId.Value && item.ProjectId == projectId);
            if (task is null) return NotFound("Task not found in this project");
            if (User.IsInRole(nameof(UserRole.Employee)) && task.AssignedToId != User.UserId())
                return Forbid();
            if (User.IsInRole(nameof(UserRole.TeamLead)) &&
                task.Team?.TeamLeadId != User.UserId())
                return Forbid();
            teamId = task.TeamId;
        }
        else if (User.IsInRole(nameof(UserRole.Employee)) || User.IsInRole(nameof(UserRole.TeamLead)))
        {
            return BadRequest("Select a task to attach this deliverable");
        }

        Directory.CreateDirectory(Folder);
        var stored = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
        await using (var fs = System.IO.File.Create(Path.Combine(Folder, stored)))
            await file.CopyToAsync(fs);

        db.Files.Add(new ProjectFile
        {
            ProjectId = projectId,
            TaskId = taskId,
            FileName = Path.GetFileName(file.FileName),
            StoredName = stored,
            ContentType = file.ContentType,
            Size = file.Length,
            UploadedById = User.UserId()
        });
        db.History.Add(new ProjectHistory
        {
            ProjectId = projectId,
            TeamId = teamId,
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
        var f = await db.Files.VisibleTo(User).FirstOrDefaultAsync(x => x.Id == fileId && x.ProjectId == projectId);
        if (f is null) return NotFound();
        var path = Path.Combine(Folder, f.StoredName);
        return System.IO.File.Exists(path) ? PhysicalFile(path, f.ContentType, f.FileName) : NotFound();
    }
}
