# Novac Project Management System

Novac is a role-based project workspace for administrators, project managers, and employees. It includes project tracking, task assignment and progress updates, team administration, task review, comments, and project activity history.

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

The current database has one active account: **Admin — `admin@nova.com` / `Admin@123`**. There are no Manager or Employee accounts yet. Sign in as Admin and add them under **Team → Add member**, setting a temporary password for each. Passwords are BCrypt hashes in SQL Server and cannot be recovered from the database.

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

The additive migration `AddTaskReviewAndComments` adds nullable task deadlines, a priority column (existing tasks default to Normal), reviewer metadata, and a `TaskComments` table. It does not drop or rewrite existing tables or records. Existing task status value `3` remains Completed.

For manual review/application in SSMS, back up `NovaProjectDb`, select that database in SSMS, then open and execute [AddTaskReviewAndComments.sql](./AddTaskReviewAndComments.sql) **once**. Alternatively, start the API and let EF Core apply the migration automatically—do not execute the script again after it has already been applied. Verify it appears in `__EFMigrationsHistory` as `20261118150451_AddTaskReviewAndComments`.

### Postman examples

Set `baseUrl` to `http://localhost:5025`. Use **Authorization → Bearer Token** and paste the `token` returned by login. Create users/projects first and substitute the returned IDs in later URLs.

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

   Role values are Admin `1`, Manager `2`, Employee `3`. Log in with each created account's email and temporary password to get its token. Use the `id` returned by each create-user response in later requests.

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

5. **Create and assign a task** — `POST {{baseUrl}}/api/projects/{{projectId}}/tasks` (Manager token)

   ```json
   {
     "title": "Prepare the homepage wireframe",
     "assignedToId": 4,
     "dueDate": "2026-12-10T00:00:00Z"
   }
   ```

   Tasks default to Normal priority. The sample IDs `3` and `4` assume a fresh manager and employee after the existing Admin; always replace them with the IDs returned by your API.

6. **Update task status** — `PUT {{baseUrl}}/api/projects/{{projectId}}/tasks/{{taskId}}/status` (Employee token)

   Set status to In Progress, then submit it for review:

   ```json
   { "status": 2 }
   ```

   ```json
   { "status": 4 }
   ```

   Statuses are To Do `1`, In Progress `2`, Completed `3`, In Review `4`. Employees cannot mark tasks Completed directly.

7. **Approve or reject a submitted task** — `PUT {{baseUrl}}/api/projects/{{projectId}}/tasks/{{taskId}}/review` (Manager token)

   ```json
   { "approve": true, "comment": "Reviewed and approved." }
   ```

   Rejection returns the task to In Progress; an optional note is saved as a task comment:

   ```json
   { "approve": false, "comment": "Please update the mobile layout." }
   ```

8. **Add a task comment** — `POST {{baseUrl}}/api/projects/{{projectId}}/tasks/{{taskId}}/comments` (project member token)

   ```json
   { "content": "The first draft is ready for feedback." }
   ```

JWT logout is handled by clearing the token in the frontend; API tokens expire after eight hours. Existing file endpoints remain available.

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
- **Manager:** view assigned projects, add employees to projects, create and assign tasks with deadlines, track progress, and approve or return submitted tasks.
- **Employee:** view assigned projects and tasks, update task status, submit work for review, and comment on tasks.

## Build checks

```powershell
Set-Location .\frontend
npm run lint
npm run build

Set-Location ..\backend.Api
dotnet build
```
