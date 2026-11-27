using backend.Api.Data;
using backend.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace backend.Api.Helpers;

public static class ProjectStaffing
{
    // Serialize roster changes with project status changes so competing requests cannot
    // activate the same employee or Team Lead in two projects.
    public static async Task<IDbContextTransaction> BeginUpdateAsync(this AppDbContext db)
    {
        var transaction = await db.Database.BeginTransactionAsync();
        try
        {
            await db.Database.ExecuteSqlRawAsync("""
                DECLARE @result int;
                EXEC @result = sys.sp_getapplock
                    @Resource = N'Novac.ProjectStaffing', @LockMode = 'Exclusive',
                    @LockOwner = 'Transaction', @LockTimeout = 10000;
                IF @result < 0 THROW 50001, 'Could not lock project staffing.', 1;
                """);
            return transaction;
        }
        catch
        {
            await transaction.DisposeAsync();
            throw;
        }
    }

    public static IQueryable<int> EmployeesInOtherActiveProjects(this AppDbContext db, int projectId) =>
        db.ProjectMembers.Where(member => member.ProjectId != projectId &&
            member.Project.Status == ProjectStatus.Active).Select(member => member.UserId)
        .Union(db.TeamMembers.Where(member => member.Team.ProjectId != projectId &&
            member.Team.Project.Status == ProjectStatus.Active).Select(member => member.UserId));

    public static Task<bool> EmployeesHaveOtherActiveProject(this AppDbContext db, int projectId, int[] ids) =>
        db.EmployeesInOtherActiveProjects(projectId).AnyAsync(id => ids.Contains(id));

    public static IQueryable<int> LeadsInOtherActiveProjects(this AppDbContext db, int projectId) =>
        db.Teams.Where(team => team.ProjectId != projectId &&
            team.Project.Status == ProjectStatus.Active).Select(team => team.TeamLeadId);

    public static Task<bool> LeadsHaveOtherActiveProject(this AppDbContext db, int projectId, int[] ids) =>
        db.LeadsInOtherActiveProjects(projectId).AnyAsync(id => ids.Contains(id));
}
