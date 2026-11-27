# Novac Project Management System

Novac is a role-based project workspace for administrators, project managers, team leads, and employees. It supports project tracking, team management, resource sharing, task assignment, task review, and project activity history.

## Stack

- ASP.NET Core 10 Web API and Entity Framework Core 10
- React and Vite
- SQL Server

## Run locally

### Backend

The backend is an ASP.NET Core Web API targeting **.NET 10**. Open `backend.Api\backend.Api.csproj` in Visual Studio Community, or run it from PowerShell. Ensure SQL Server Express is running; the existing database remains `NovaProjectDb`.

```powershell
Set-Location 'D:\Project_Mangagement_System\backend.Api'
dotnet run --launch-profile http
```

The configured connection in `appsettings.json` uses `localhost\SQLEXPRESS`. Override `ConnectionStrings__Default` only if you intend to use a different SQL Server database. The database connection and JWT issuer/audience identifiers have not been renamed.

The development database includes **Admin — `admin@nova.com` / `Admin@123`**, plus existing manager and employee accounts. Sign in as Admin and use **Team → Add member** to create additional accounts and set their temporary passwords. Passwords are BCrypt hashes in SQL Server and cannot be recovered from the database.

The local workflow sample adds Sneha Reddy as a Project Manager, Sanjay Kumar and Deepak Raj as Team Leaders, and two test Employees. It keeps the existing E-Commerce Website project and adds four projects so the database has five projects total. Team Alpha is associated with Rahul Sharma's existing project; Team Beta is associated with Sneha Reddy's Team Beta Platform project. The generated temporary credentials are provided in the implementation handoff; replace them before sharing the development database.

On startup, the API applies pending Entity Framework migrations. For a fresh database only, set `BootstrapAdmin__Email` and `BootstrapAdmin__Password` (at least 12 characters) before starting; the bootstrap account is not created if an Admin already exists. Development uses a local-only JWT signing key from `appsettings.Development.json`; use a private `Jwt__Key` of at least 32 bytes in production. The API listens on `http://localhost:5025`.

### Frontend

In a second terminal:

```powershell
Set-Location 'D:\Project_Mangagement_System\frontend'
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` requests to the local backend. Bootstrap 5 is included in the existing React app.

### Database migration / SSMS

The additive migrations are `AddTaskReviewAndComments`, `20261126150732_AddTeamsAndNotifications`, and `AddTaskDescription`. The existing database already has the team migration recorded, including Teams, TeamMembers, task/team links and file/task links; the matching migration source is retained so EF does not try to create those tables again. `AddTaskDescription` adds only a nullable description column to ProjectTasks. No existing records or tables are removed or rewritten. Existing task status value `3` remains Completed.

For manual review/application in SSMS, back up `NovaProjectDb`, select that database in SSMS, then open and execute [AddTaskReviewAndComments.sql](./AddTaskReviewAndComments.sql) **once**. Alternatively, start the API and let EF Core apply the migration automatically—do not execute the script again after it has already been applied. Verify it appears in `__EFMigrationsHistory` as `20261118150451_AddTaskReviewAndComments`.

### Postman examples

Import [Novac.postman_collection.json](./Novac.postman_collection.json), set `baseUrl` to `http://localhost:5025`, and use the login request to store role-specific tokens. Create users/projects first and substitute returned IDs in later URLs. The collection includes Team Leader creation, team assignment, Team Leader task assignment, employee submission, reviews, and a forbidden-access check.

1. **Admin login** — `POST {{baseUrl}}/api/auth/login`

   ```json
   { "email": "admin@nova.com", "password": "Admin@123" }
   ```

2. **Create a Manager** — `POST {{baseUrl}}/api/users` (Admin token)

   ```json
   {
     "fullName": "Project Manager",
     "email": "manager@example.com",
     "password": "ManagerPass123!",
     "role": 2,
     "designation": "Project Manager"
   }
   ```

   Create a Team Leader the same way with a unique email and role `4`:

   ```json
   {
     "fullName": "Sanjay Kumar",
     "email": "sanjay.kumar@example.com",
     "password": "Set-a-temporary-password",
     "role": 4,
     "designation": "Technical Team Leader"
   }
   ```

   Create an Employee the same way with a unique email:

   ```json
   {
     "fullName": "Project Employee",
     "email": "employee@example.com",
     "password": "EmployeePass123!",
     "role": 3,
     "designation": "Designer"
   }
   ```

   Role values are Admin `1`, Manager `2`, Employee `3`, Team Leader `4`. Log in with each created account's email and temporary password to get its token. Use the `id` returned by each create-user response in later requests.

3. **Create a project and assign its manager** — `POST {{baseUrl}}/api/projects` (Admin token)

   ```json
   {
     "name": "Website Refresh",
     "description": "Refresh the company website.",
     "startDate": "2026-11-18T00:00:00Z",
     "endDate": "2027-01-30T00:00:00Z",
     "status": 1,
     "managerId": 3
   }
   ```

4. **Add employees to that project** — `POST {{baseUrl}}/api/projects/{{projectId}}/members/bulk` (Manager token)

   ```json
   { "userIds": [4, 5] }
   ```

5. **Create a team** — `POST {{baseUrl}}/api/projects/{{projectId}}/teams` (Manager token)

   ```json
   { "name": "Team Alpha", "teamLeadId": 8, "employeeIds": [4, 5] }
   ```

   To share resources during creation, submit multipart fields `name`, `teamLeadId`, and repeated `employeeIds` and `resources` fields. The Team Lead can download the resources from the team card.

6. **Create and assign a task** — `POST {{baseUrl}}/api/projects/{{projectId}}/tasks` (Team Lead token)

   ```json
   {
     "title": "Prepare the homepage wireframe",
     "assignedToId": 4,
     "dueDate": "2026-12-10T00:00:00Z"
   }
   ```

   Tasks default to Normal priority. Replace the example IDs with the IDs returned by the API. Team Leads can choose their own ID or an employee on one of their teams.

7. **Update task status** — `PUT {{baseUrl}}/api/projects/{{projectId}}/tasks/{{taskId}}/status` (assignee token)

   Set status to In Progress, then submit it for review:

   ```json
   { "status": 2 }
   ```

   ```json
   { "status": 4 }
   ```

   Statuses are To Do `1`, In Progress `2`, Completed `3`, In Review `4`. Employees cannot mark tasks Completed directly.

8. **Review a submitted task** — `PUT {{baseUrl}}/api/projects/{{projectId}}/tasks/{{taskId}}/review` (Project Manager or Team Lead token)

   ```json
   { "approve": true }
   ```

   Set `approve` to `false` to return the task to In Progress. The Project Manager reviews tasks a Team Lead assigns to themselves.

9. **Change your password** — `PUT {{baseUrl}}/api/auth/password` (account token)

   Submit `currentPassword` and `newPassword`, or use **Change password** from the profile avatar.

Project Managers, Team Leads, and employees see their own active and completed projects. Team Leads and employees can join one active project at a time. For legacy overlaps, their most recently started active project appears alongside their completed projects.

### Docker

With Docker Compose installed, set the required values in PowerShell and start the full stack:

```powershell
$env:MSSQL_SA_PASSWORD = '<strong SQL Server password; avoid semicolons>'
$env:JWT_KEY = '<a private random secret of at least 32 bytes>'
$env:BOOTSTRAP_ADMIN_EMAIL = 'admin@example.com'
$env:BOOTSTRAP_ADMIN_PASSWORD = '<a private password of at least 12 characters>'
docker compose up --build
```

Open `http://localhost:8080`. Compose persists SQL Server data in the `sqlserver-data` volume. The frontend container proxies `/api` requests to the API service, and the API applies migrations and creates the initial administrator on first startup.

## Roles

- **Admin:** create projects, assign managers, manage accounts, and view all projects and tasks. Admins do not create or approve tasks.
- **Project Manager:** view assigned projects and their status, manage project and team rosters, share resources with Team Leads, and review submitted tasks.
- **Team Lead:** view assigned projects and team resources, assign work to employees or themselves, and review employee submissions.
- **Employee:** view assigned projects and teams, update their own task status, submit work for review, and upload deliverables.

## Build checks

```powershell
Set-Location .\frontend
npm run lint
npm run build

Set-Location ..\backend.Api
dotnet build
```
