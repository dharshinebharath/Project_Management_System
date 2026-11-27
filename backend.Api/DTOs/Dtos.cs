using backend.Api.Models;

namespace backend.Api.DTOs;

public record LoginDto(string Email, string Password);
public record LoginResult(string Token, int Id, string FullName, string Email, string Role);
public record ChangePasswordDto(string CurrentPassword, string NewPassword);

public record UserDto(int Id, string FullName, string Email, UserRole Role, string? Designation, bool IsActive);
public record UserCreateDto(string FullName, string Email, string Password, UserRole Role, string? Designation);
public record UserUpdateDto(string FullName, UserRole Role, string? Designation, bool IsActive, string? NewPassword);

public record ProjectSaveDto(string Name, string? Description, DateTime StartDate, DateTime? EndDate, ProjectStatus Status, int ManagerId);
public record ProjectListDto(int Id, string Name, ProjectStatus Status, DateTime StartDate, DateTime? EndDate,
                             string ManagerName, int MemberCount, int Progress);
public record MemberDto(int UserId, string FullName, string Email, string? Designation, DateTime JoinedAt);
public record ProjectDetailDto(int Id, string Name, string? Description, DateTime StartDate, DateTime? EndDate,
                               ProjectStatus Status, int ManagerId, string ManagerName, List<MemberDto> Members);
public record HistoryDto(int Id, string Action, string PerformedBy, DateTime CreatedAt);

public record AddMemberDto(int UserId);
public record AddMembersDto(int[] UserIds);
public record TaskCreateDto(string Title, int? AssignedToId, DateTime? DueDate = null,
                            TaskPriority Priority = TaskPriority.Normal, int? TeamId = null,
                            string? Description = null, DateOnly? StartDate = null);
public record TaskStatusDto(WorkStatus Status);
public record TaskReviewDto(bool Approve);
public record TaskDto(int Id, string Title, int? AssignedToId, string? AssignedToName, WorkStatus Status,
                      DateTime? DueDate, TaskPriority Priority, DateTime? ReviewedAt,
                      int? TeamId = null, string? TeamName = null, string? Description = null,
                      DateOnly? StartDate = null);

public record RequestCreateDto(int ProjectId, int EmployeeId, string? Note);
public record RequestReviewDto(bool Approve);
public record RequestDto(int Id, int ProjectId, string ProjectName, int EmployeeId, string EmployeeName,
                         string RequestedBy, string? Note, RequestStatus Status, DateTime CreatedAt);

public record FileDto(int Id, string FileName, long Size, string UploadedBy, DateTime UploadedAt,
                      int? TaskId = null);
public record ChartItem(string Label, int Value);
public record TeamCreateDto(string Name, int TeamLeadId, int[] EmployeeIds);
public record TeamUpdateDto(string Name, int TeamLeadId, int[] EmployeeIds);
public record TeamMemberSummaryDto(int UserId, string FullName, string Email, string? Designation, bool IsActive);
public record TeamDto(int Id, int ProjectId, string Name, int TeamLeadId, string TeamLeadName,
                      string ProjectName, List<TeamMemberSummaryDto> Members, int TotalTasks, int PendingTasks,
                      int InProgressTasks, int ReviewTasks, int CompletedTasks, int OverdueTasks,
                      List<FileDto> Resources);
