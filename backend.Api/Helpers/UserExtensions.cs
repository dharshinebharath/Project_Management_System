using System.Security.Claims;
using backend.Api.Models;

namespace backend.Api.Helpers;

public static class UserExtensions
{
    public static int UserId(this ClaimsPrincipal u) =>
        int.Parse(u.FindFirstValue(ClaimTypes.NameIdentifier)!);

    // Admin sees all, Manager sees own projects, Employee sees assigned projects
    public static IQueryable<Project> VisibleTo(this IQueryable<Project> q, ClaimsPrincipal u)
    {
        var id = u.UserId();
        if (u.IsInRole("Admin")) return q;
        if (u.IsInRole("Manager")) return q.Where(p => p.ManagerId == id);
        return q.Where(p => p.Members.Any(m => m.UserId == id));
    }
}