using Microsoft.EntityFrameworkCore;
using backend.Api.Models;

namespace backend.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<ProjectMember> ProjectMembers => Set<ProjectMember>();
    public DbSet<Team> Teams => Set<Team>();
    public DbSet<TeamMember> TeamMembers => Set<TeamMember>();
    public DbSet<ProjectTask> ProjectTasks => Set<ProjectTask>();
    public DbSet<TaskComment> TaskComments => Set<TaskComment>();
    public DbSet<ProjectHistory> History => Set<ProjectHistory>();
    public DbSet<ProjectFile> Files => Set<ProjectFile>();
    public DbSet<TeamRequest> Requests => Set<TeamRequest>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>().HasIndex(u => u.Email).IsUnique();
        b.Entity<TeamMember>().HasKey(m => new { m.TeamId, m.UserId });

        // Avoid SQL Server multiple cascade paths; project-owned rows cascade with the project.
        foreach (var fk in b.Model.GetEntityTypes().SelectMany(e => e.GetForeignKeys()))
            fk.DeleteBehavior = fk.Properties[0].Name == "ProjectId"
                ? DeleteBehavior.Cascade
                : DeleteBehavior.Restrict;

        b.Entity<ProjectTask>()
            .HasOne(t => t.ReviewedBy)
            .WithMany()
            .HasForeignKey(t => t.ReviewedById)
            .OnDelete(DeleteBehavior.Restrict);
        b.Entity<ProjectTask>()
            .HasOne(t => t.Team)
            .WithMany(team => team.Tasks)
            .HasForeignKey(t => t.TeamId)
            .OnDelete(DeleteBehavior.Restrict);
        b.Entity<TeamMember>()
            .HasOne(m => m.Team)
            .WithMany(team => team.Members)
            .HasForeignKey(m => m.TeamId)
            .OnDelete(DeleteBehavior.Cascade);
        b.Entity<TeamMember>()
            .HasOne(m => m.User)
            .WithMany()
            .HasForeignKey(m => m.UserId)
            .OnDelete(DeleteBehavior.Restrict);
        b.Entity<ProjectFile>()
            .HasOne(f => f.Team)
            .WithMany(team => team.Resources)
            .HasForeignKey(f => f.TeamId)
            .OnDelete(DeleteBehavior.NoAction);
        b.Entity<ProjectHistory>()
            .HasOne(history => history.Team)
            .WithMany()
            .HasForeignKey(history => history.TeamId)
            .OnDelete(DeleteBehavior.NoAction);
        b.Entity<ProjectFile>()
            .HasOne(f => f.Task)
            .WithMany()
            .HasForeignKey(f => f.TaskId)
            .OnDelete(DeleteBehavior.Restrict);
        b.Entity<ProjectTask>()
            .Property(t => t.Priority)
            .HasDefaultValue(TaskPriority.Normal)
            .HasSentinel(TaskPriority.Normal);
        b.Entity<TaskComment>()
            .HasOne(c => c.Author)
            .WithMany()
            .HasForeignKey(c => c.AuthorId)
            .OnDelete(DeleteBehavior.Restrict);
        b.Entity<TaskComment>()
            .HasOne(c => c.Task)
            .WithMany(t => t.Comments)
            .HasForeignKey(c => c.TaskId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
