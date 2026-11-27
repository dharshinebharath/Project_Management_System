using System.Security.Claims;
using backend.Api.Models;

namespace backend.Api.Helpers;

public static class UserExtensions
{
    public static int UserId(this ClaimsPrincipal u) =>
        int.Parse(u.FindFirstValue(ClaimTypes.NameIdentifier)!);

    // Admin sees all; other roles are scoped to their project, team, or task assignments.
    public static IQueryable<Project> VisibleTo(this IQueryable<Project> q, ClaimsPrincipal u)
    {
        var id = u.UserId();
        if (u.IsInRole("Admin")) return q;
        q = q.Where(p => p.Status == ProjectStatus.Active || p.Status == ProjectStatus.Completed);
        if (u.IsInRole("Manager")) return q.Where(p => p.ManagerId == id);
        if (u.IsInRole("TeamLead"))
            return OneActiveProject(q.Where(p => p.Teams.Any(t => t.TeamLeadId == id)));
        if (u.IsInRole("Employee"))
            return OneActiveProject(q.Where(p => p.Members.Any(m => m.UserId == id) ||
                p.Teams.Any(t => t.Members.Any(m => m.UserId == id))));
        return q.Where(_ => false);
    }

    private static IQueryable<Project> OneActiveProject(IQueryable<Project> assignments)
    {
        // Keep legacy assignments and show the most recently started active project.
        var currentProject = assignments.Where(project => project.Status == ProjectStatus.Active)
            .OrderByDescending(project => project.StartDate).ThenByDescending(project => project.Id)
            .Select(project => project.Id).Take(1);
        return assignments.Where(project => project.Status == ProjectStatus.Completed ||
            currentProject.Contains(project.Id));
    }

    public static IQueryable<ProjectFile> VisibleTo(this IQueryable<ProjectFile> files, ClaimsPrincipal user)
    {
        var id = user.UserId();
        if (user.IsInRole(nameof(UserRole.TeamLead)))
            return files.Where(file => (file.Team == null || file.Team.TeamLeadId == id) &&
                (file.Task == null || file.Task.Team != null && file.Task.Team.TeamLeadId == id));
        if (user.IsInRole(nameof(UserRole.Employee)))
            return files.Where(file => file.TeamId == null &&
                (file.Task == null || file.Task.AssignedToId == id));
        return files;
    }
}
