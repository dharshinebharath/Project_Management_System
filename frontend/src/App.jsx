import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { api, downloadFile, jsonBody } from './api'
import './App.css'

const PROJECT_STATUS = { 1: 'Active', 2: 'Completed', 3: 'On hold' }
const TASK_STATUS = { 1: 'To Do', 2: 'In Progress', 3: 'Completed', 4: 'In Review' }
const TASK_PRIORITY = { 1: 'Low', 2: 'Normal', 3: 'High' }
const ROLE_NAMES = {
  1: 'Admin', 2: 'Project Manager', 3: 'Employee', 4: 'Team Lead',
  Admin: 'Admin', Manager: 'Project Manager', Employee: 'Employee', TeamLead: 'Team Lead',
}
const SESSION_KEY = 'novac-session'
const PREVIOUS_SESSION_KEY = 'nova-session'
const ActionFeedback = createContext(null)
const NOTIFICATION_DURATION_MS = 4500
const TEAM_ACTIVITY_REFRESH_MS = 10000

function useNotification() {
  const [notification, setNotification] = useState(null)
  const showMessage = useCallback((message) => {
    setNotification(message ? { message } : null)
  }, [])

  useEffect(() => {
    if (!notification) return
    const timeout = window.setTimeout(() => {
      setNotification((current) => current === notification ? null : current)
    }, NOTIFICATION_DURATION_MS)
    return () => window.clearTimeout(timeout)
  }, [notification])

  return [notification?.message || '', showMessage]
}

function readSession() {
  try {
    const stored = localStorage.getItem(SESSION_KEY) || localStorage.getItem(PREVIOUS_SESSION_KEY)
    if (!stored) return null
    localStorage.setItem(SESSION_KEY, stored)
    localStorage.removeItem(PREVIOUS_SESSION_KEY)
    return JSON.parse(stored)
  } catch {
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(PREVIOUS_SESSION_KEY)
    return null
  }
}

function formatDate(value) {
  if (!value) return 'No deadline'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

function formatTaskDate(value) {
  return value ? formatDate(`${value.slice(0, 10)}T00:00:00`) : 'No deadline'
}

function teamFormBody({ name, teamLeadId, employeeIds, resources }) {
  const body = new FormData()
  body.append('name', name)
  body.append('teamLeadId', String(teamLeadId))
  employeeIds.forEach((id) => body.append('employeeIds', String(id)))
  resources.forEach((file) => body.append('resources', file))
  return body
}

function localDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function initials(name = '') {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase()
}

function App() {
  const [session, setSession] = useState(readSession)
  const [page, setPage] = useState(() => session?.role === 'TeamLead' ? 'Dashboard' : 'Overview')
  const [projects, setProjects] = useState([])
  const [summary, setSummary] = useState(null)
  const [people, setPeople] = useState([])
  const [managers, setManagers] = useState([])
  const [availableStaff, setAvailableStaff] = useState([])
  const [teamLeadStats, setTeamLeadStats] = useState(null)
  const [teamLeadTasks, setTeamLeadTasks] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [projectData, setProjectData] = useState(null)
  const [projectTeams, setProjectTeams] = useState([])
  const [tasks, setTasks] = useState([])
  const [history, setHistory] = useState(null)
  const [projectStats, setProjectStats] = useState(null)
  const [projectLoadedId, setProjectLoadedId] = useState(null)
  const [selectedTaskId, setSelectedTaskId] = useState(null)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState('')
  const [editingPerson, setEditingPerson] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useNotification()
  const [actionError, setActionError] = useNotification()
  const [notice, setNotice] = useNotification()
  const [reload, setReload] = useState(0)
  const role = session?.role
  const displayName = role === 'Admin' ? 'Admin' : session?.fullName
  const selectedProjectId = selectedProject?.id
  const canStaffProject = role === 'Manager' && selectedProject?.status === 1

  useEffect(() => {
    if (!session?.token) return
    let active = true
    async function loadWorkspace() {
      try {
        const [projectRows, dashboard] = await Promise.all([
          api('/projects', { token: session.token }),
          api('/dashboard/summary', { token: session.token }),
        ])
        if (!active) return
        setProjects(projectRows)
        setSelectedProject((current) => current ? projectRows.find((project) => project.id === current.id) || null : null)
        setSummary(dashboard)

        if (role === 'Admin') {
          const [users, managerRows] = await Promise.all([
            api('/users', { token: session.token }),
            api('/users/managers', { token: session.token }),
          ])
          if (!active) return
          setPeople(users)
          setManagers(managerRows)
        } else if (role === 'TeamLead') {
          const [stats, taskLists] = await Promise.all([
            api('/dashboard/team-lead', { token: session.token }),
            Promise.all(projectRows.filter((project) => project.status === 1).map(async (project) => {
              const rows = await api(`/projects/${project.id}/tasks`, { token: session.token })
              return rows.map((task) => ({ ...task, projectId: project.id, projectName: project.name }))
            })),
          ])
          if (!active) return
          setTeamLeadStats(stats)
          setTeamLeadTasks(taskLists.flat())
        }
        setError('')
      } catch (requestError) {
        if (active) setError(requestError.message)
      } finally {
        if (active) setLoading(false)
      }
    }
    loadWorkspace()
    return () => { active = false }
  }, [reload, role, session?.token, setError])

  useEffect(() => {
    if (!session?.token || !selectedProjectId) return
    let active = true
    const projectPath = `/projects/${selectedProjectId}`
    Promise.all([
      api(projectPath, { token: session.token }),
      role === 'Admin' ? [] : api(`${projectPath}/tasks`, { token: session.token }),
      api(`/dashboard/project/${selectedProjectId}`, { token: session.token }),
      role === 'Admin' ? [] : api(`${projectPath}/teams`, { token: session.token }),
      canStaffProject ? api(`${projectPath}/teams/available-people`, { token: session.token }) : [],
    ]).then(([detail, taskRows, stats, teams, staff]) => {
      if (!active) return
      setProjectData(detail)
      setTasks(taskRows)
      setProjectStats(stats)
      setProjectTeams(teams)
      setAvailableStaff(staff)
      setProjectLoadedId(selectedProjectId)
    }).catch((requestError) => {
      if (active) setError(requestError.message)
    })
    return () => { active = false }
  }, [canStaffProject, reload, role, selectedProjectId, session?.token, setError])

  useEffect(() => {
    if (!session?.token || !selectedProjectId || role === 'Admin') return
    const controller = new AbortController()
    let loadingHistory = false

    async function loadHistory(showError) {
      if (loadingHistory) return
      loadingHistory = true
      try {
        const entries = await api(`/projects/${selectedProjectId}/history`, {
          token: session.token, signal: controller.signal,
        })
        if (!controller.signal.aborted) setHistory({ projectId: selectedProjectId, entries })
      } catch (requestError) {
        if (showError && !controller.signal.aborted) setError(requestError.message)
      } finally {
        loadingHistory = false
      }
    }

    loadHistory(true)
    const timer = role === 'TeamLead' ? window.setInterval(() => {
      if (!document.hidden) loadHistory(false)
    }, TEAM_ACTIVITY_REFRESH_MS) : null
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [reload, role, selectedProjectId, session?.token, setError])

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return projects
    return projects.filter((project) =>
      `${project.name} ${project.managerName} ${PROJECT_STATUS[project.status]}`.toLowerCase().includes(query),
    )
  }, [projects, search])

  function signOut() {
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(PREVIOUS_SESSION_KEY)
    setSession(null)
    setSelectedProject(null)
    setSelectedTaskId(null)
    setProjectLoadedId(null)
    setHistory(null)
    setProjects([])
    setSummary(null)
    setPeople([])
    setLoading(true)
    setModal('')
    setActionError('')
    setError('')
    setNotice('')
    setPage('Overview')
  }

  async function perform(action, successMessage) {
    setBusy(true)
    setError('')
    setActionError('')
    setNotice('')
    try {
      await action()
      setNotice(successMessage)
      setModal('')
      setReload((value) => value + 1)
      return true
    } catch (requestError) {
      setActionError(requestError.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  function openTeamTask(task) {
    const project = projects.find((item) => item.id === task.projectId)
    if (!project) return
    setPage(role === 'TeamLead' ? 'My Projects' : 'Projects')
    setSelectedProject(project)
    setSelectedTaskId(task.id)
  }

  function openProfile() {
    setSelectedProject(null)
    setSelectedTaskId(null)
    setPage('Profile')
  }

  if (!session) {
    return <LoginScreen onLogin={(result) => {
      localStorage.setItem(SESSION_KEY, JSON.stringify(result))
      setSession(result)
      setPage(result.role === 'TeamLead' ? 'Dashboard' : 'Overview')
    }} />
  }

  const navItems = role === 'TeamLead'
    ? [
      { label: 'Dashboard', icon: '◫' },
      { label: 'My Projects', icon: '▦' },
      { label: 'Review Queue', icon: '↗' },
    ]
    : [
      { label: 'Overview', icon: '◫' },
      { label: role === 'Admin' ? 'Projects' : 'My Projects', icon: '▦' },
      ...(role === 'Admin' ? [{ label: 'Employee Management', icon: '♙' }] : []),
    ]

  return (
    <ActionFeedback.Provider value={{
      error: actionError, notice,
      clearError: () => setActionError(''), clearNotice: () => setNotice(''),
    }}>
    <div className="app-shell">
      <aside className={`sidebar ${role === 'TeamLead' ? 'team-lead-sidebar' : ''}`}>
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setPage(role === 'TeamLead' ? 'Dashboard' : 'Overview'); setSelectedProject(null) }}>
          <span className="brand-mark">N</span>
          <span>novac</span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button key={item.label} className={page === item.label && !selectedProject ? 'nav-item active' : 'nav-item'} onClick={() => { setPage(item.label); setSelectedProject(null); setSelectedTaskId(null) }}>
              <span className="nav-icon">{item.icon}</span>{item.label}
            </button>
          ))}
          <button className="nav-item mobile-signout" onClick={signOut} aria-label="Sign out">
            <span className="nav-icon">↪</span>Sign out
          </button>
        </nav>
        <div className="sidebar-bottom">
          <AccountMenu displayName={displayName} role={role} onProfile={openProfile} onLogout={signOut} sidebar />
          <button type="button" className="signout-icon" onClick={signOut} aria-label="Log out" title="Log out">↪</button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span><span className="crumb-slash">/</span>
            <strong>{selectedProject ? selectedProject.name : page}</strong>
          </div>
          <div className="topbar-actions">
            <span className="today-label">{new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</span>
            <AccountMenu displayName={displayName} role={role} onProfile={openProfile} onLogout={signOut} />
          </div>
        </header>

        <div className="page-content">
          {(error || actionError) && <div className="alert alert-error page-error" role="alert"><span>{error || actionError}</span><button onClick={() => { setError(''); setActionError('') }} aria-label="Dismiss error">×</button></div>}
          {notice && <div className="alert alert-success page-notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss message">×</button></div>}
          {loading && !projects.length ? <div className="loading-state"><span className="spinner" />Loading your workspace…</div> : null}

          {selectedProject ? (
            <ProjectView
              key={selectedProject.id}
              project={selectedProject}
              detail={projectLoadedId === selectedProject.id ? projectData : null}
              tasks={projectLoadedId === selectedProject.id ? tasks : []}
              stats={projectLoadedId === selectedProject.id ? projectStats : null}
              history={history?.projectId === selectedProject.id ? history.entries : []}
              projectLoading={projectLoadedId !== selectedProject.id}
              people={projectLoadedId === selectedProject.id ? availableStaff.filter((person) => person.role === 3) : []}
              session={session}
              managers={managers}
              teamLeads={projectLoadedId === selectedProject.id ? availableStaff.filter((person) => person.role === 4) : []}
              teams={projectLoadedId === selectedProject.id ? projectTeams : []}
              selectedTask={projectLoadedId === selectedProject.id ? tasks.find((task) => task.id === selectedTaskId) || null : null}
              role={role}
              busy={busy}
              onBack={() => { setSelectedProject(null); setSelectedTaskId(null) }}
              canEditProject={role === 'Admin'}
              onEditProject={() => setModal('editProject')}
              onAddTask={() => setModal('task')}
              onAddTeam={() => setModal('team')}
              onAddMember={() => setModal('member')}
              onOpenTask={setSelectedTaskId}
              onCloseTask={() => setSelectedTaskId(null)}
              onAddMemberToProject={(userIds) => perform(() => api(`/projects/${selectedProject.id}/members/bulk`, {
                token: session.token, method: 'POST', body: jsonBody({ userIds }),
              }), 'Employees added to project')}
              onRemoveMember={(userId) => perform(() => api(`/projects/${selectedProject.id}/members/${userId}`, {
                token: session.token, method: 'DELETE',
              }), 'Employee removed from project')}
              onCreateTask={(values) => perform(() => api(`/projects/${selectedProject.id}/tasks`, {
                token: session.token, method: 'POST', body: jsonBody(values),
              }), 'Task created')}
              onCreateTeam={(values) => perform(() => api(`/projects/${selectedProject.id}/teams`, {
                token: session.token, method: 'POST', body: teamFormBody(values),
              }), 'Team created')}
              onUpdateTeam={(teamId, values) => perform(() => api(`/projects/${selectedProject.id}/teams/${teamId}`, {
                token: session.token, method: 'PUT', body: teamFormBody(values),
              }), 'Team updated')}
              onUpdateProject={(values) => perform(() => api(`/projects/${selectedProject.id}`, {
                token: session.token, method: 'PUT', body: jsonBody(values),
              }), 'Project updated')}
              onUpdateTask={(taskId, status) => perform(() => api(`/projects/${selectedProject.id}/tasks/${taskId}/status`, {
                token: session.token, method: 'PUT', body: jsonBody({ status }),
              }), 'Task status updated')}
              onReviewTask={(taskId, values) => perform(() => api(`/projects/${selectedProject.id}/tasks/${taskId}/review`, {
                token: session.token, method: 'PUT', body: jsonBody(values),
              }), values.approve ? 'Task approved' : 'Task returned for changes')}
              onUploadTaskFile={(taskId, file) => {
                const formData = new FormData()
                formData.append('file', file)
                formData.append('taskId', String(taskId))
                return perform(() => api(`/projects/${selectedProject.id}/files`, {
                  token: session.token, method: 'POST', body: formData,
                }), 'Deliverable uploaded')
              }}
              onDownloadTaskFile={(file) => downloadFile(`/projects/${selectedProject.id}/files/${file.id}/download`, session.token, file.fileName)}
              editProjectModal={modal === 'editProject'}
              taskModal={modal === 'task'}
              teamModal={modal === 'team'}
              memberModal={modal === 'member'}
              onCloseModal={() => setModal('')}
            />
          ) : page === 'Overview' ? (
            <Overview
              summary={summary}
              projects={projects}
              role={role}
              onOpenProject={(project) => setSelectedProject(project)}
              onNavigate={setPage}
            />
          ) : role === 'TeamLead' && page === 'Dashboard' ? (
            <TeamLeadDashboard
              stats={teamLeadStats}
              projects={projects}
              tasks={teamLeadTasks}
              userId={session.id}
              onOpenProject={(project) => setSelectedProject(project)}
              onOpenTask={openTeamTask}
            />
          ) : page === 'Projects' || page === 'My Projects' ? (
            <ProjectsPage
              projects={filteredProjects}
              search={search}
              onSearch={setSearch}
              onOpenProject={setSelectedProject}
              canCreate={role === 'Admin'}
              onCreate={() => setModal('project')}
              projectModal={modal === 'project'}
              managers={managers}
              busy={busy}
              onCloseModal={() => setModal('')}
              onCreateProject={(values) => perform(() => api('/projects', {
                token: session.token, method: 'POST', body: jsonBody(values),
              }), 'Project created')}
            />
          ) : role === 'TeamLead' && page === 'Review Queue' ? (
            <TeamLeadTasksPage
              tasks={teamLeadTasks.filter((task) => task.status === 4 && task.assignedToId !== session.id)}
              onOpenTask={openTeamTask}
            />
          ) : page === 'Profile' ? (
            <ProfilePage session={session} displayName={displayName} />
          ) : page === 'Employee Management' ? (
            <TeamPage
              people={people}
              onCreate={() => setModal('user')}
              userModal={modal === 'user'}
              busy={busy}
              onCloseModal={() => setModal('')}
              onCreateUser={(values) => perform(() => api('/users', {
                token: session.token, method: 'POST', body: jsonBody(values),
              }), 'Team member added')}
              onEdit={(person) => setEditingPerson(person)}
              editingPerson={editingPerson}
              onCloseEdit={() => setEditingPerson(null)}
              onUpdateUser={(id, values) => perform(() => api(`/users/${id}`, {
                token: session.token, method: 'PUT', body: jsonBody(values),
              }), 'Team member updated').then((success) => { if (success) setEditingPerson(null) })}
              onToggleActive={(person) => perform(() => api(`/users/${person.id}`, {
                token: session.token,
                method: 'PUT',
                body: jsonBody({
                  fullName: person.fullName,
                  role: person.role,
                  designation: person.designation,
                  isActive: !person.isActive,
                  newPassword: null,
                }),
              }), `${person.fullName} ${person.isActive ? 'deactivated' : 'activated'}`)}
            />
          ) : (
            <Overview
              summary={summary}
              projects={projects}
              role={role}
              onOpenProject={(project) => setSelectedProject(project)}
              onNavigate={setPage}
            />
          )}
        </div>
      </main>
    </div>
    </ActionFeedback.Provider>
  )
}

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useNotification()
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await api('/auth/login', { method: 'POST', body: jsonBody({ email, password }) })
      onLogin(result)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-page">
      <div className="login-brand"><span className="brand-mark">N</span>novac</div>
      <section className="login-card">
        <div className="eyebrow">PROJECT MANAGEMENT, MADE CLEAR</div>
        <h1>Welcome back</h1>
        <p className="login-subtitle">Sign in to pick up where your team left off.</p>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <form className="form-stack" onSubmit={submit}>
          <label>Email address<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" required /></label>
          <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required /></label>
          <button className="button button-primary login-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}<span>→</span></button>
        </form>
        <p className="login-footnote">Access is managed by your workspace administrator.</p>
      </section>
      <p className="login-copyright">Novac · Work better, together</p>
    </main>
  )
}

function Overview({ summary, projects, role, onOpenProject, onNavigate }) {
  const active = projects.filter((project) => project.status === 1).length
  const progress = projects.length ? Math.round(projects.reduce((sum, project) => sum + project.progress, 0) / projects.length) : 0
  const recent = [...projects].sort((a, b) => new Date(b.startDate) - new Date(a.startDate)).slice(0, 4)
  const taskCounts = summary?.tasksByStatus || []
  const totalTasks = taskCounts.reduce((sum, item) => sum + item.value, 0)
  const reviewTasks = taskCounts.find((item) => item.label === 'InReview')?.value || 0
  const heading = role === 'Admin' ? 'Workspace overview' : role === 'Manager' ? 'Your projects, at a glance' : 'Your work, at a glance'
  const subtitle = role === 'Employee'
    ? 'Focus on your assigned tasks and keep your team updated.'
    : role === 'Manager'
      ? 'Coordinate your projects and keep your team moving.'
      : 'Here’s what’s happening across your projects.'

  return (
    <>
      <div className="page-heading heading-row">
        <div><div className="eyebrow">{ROLE_NAMES[role] || 'YOUR WORKSPACE'} DASHBOARD</div><h1>{heading}</h1><p>{subtitle}</p></div>
        <button className="button button-secondary" onClick={() => onNavigate(role === 'Admin' ? 'Projects' : 'My Projects')}>View all projects <span>→</span></button>
      </div>
      <section className={`stat-grid ${role === 'Admin' ? 'admin-dashboard-stat-grid' : ''}`} aria-label="Workspace statistics">
        <StatCard label="Total projects" value={projects.length} icon="▦" tone="blue" detail={`${active} currently active`} />
        <StatCard label={role === 'Employee' ? 'Assigned tasks' : role === 'Manager' ? 'Tasks in progress' : 'Members'} value={role === 'Employee' ? totalTasks : role === 'Manager' ? (taskCounts.find((item) => item.label === 'InProgress')?.value || 0) : summary?.totalUsers ?? '—'} icon={role === 'Employee' || role === 'Manager' ? '✓' : '♙'} tone="violet" detail={role === 'Admin' ? 'Active members' : 'Across your projects'} />
        {role === 'Admin' && <StatCard label="Project Managers" value={summary?.totalProjectManagers ?? '—'} icon="♙" tone="violet" detail="Active accounts" />}
        <StatCard label="Average progress" value={`${progress}%`} icon="◴" tone="green" detail="Across visible projects" />
        {role !== 'Admin' && <StatCard label="Tasks in review" value={reviewTasks} icon="↗" tone="orange" detail={role === 'Employee' ? 'Submitted for review' : 'Awaiting review'} />}
      </section>
      <section className="content-grid">
        <div className="panel project-panel">
          <div className="panel-heading"><div><h2>Recent projects</h2><p>A quick look at work in motion</p></div><button className="text-button" onClick={() => onNavigate(role === 'Admin' ? 'Projects' : 'My Projects')}>See all <span>→</span></button></div>
          {recent.length ? <div className="project-list">{recent.map((project) => <ProjectRow key={project.id} project={project} onClick={() => onOpenProject(project)} />)}</div> : <EmptyState title="No projects yet" detail="Projects you can access will show up here." />}
        </div>
        <div className="panel focus-panel">
          <div className="panel-heading"><div><h2>Workspace snapshot</h2><p>Progress at a glance</p></div><span className="snapshot-icon">✳</span></div>
          <div className="snapshot-progress"><div className="snapshot-value">{progress}<small>%</small></div><span>average completion</span></div>
          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
          <div className="snapshot-meta"><span>{active} active projects</span><span>{projects.length} total projects</span></div>
          <div className="focus-note"><span>✦</span><p>Small steps add up. Keep tasks moving to make your team’s progress visible.</p></div>
        </div>
      </section>
    </>
  )
}

function StatCard({ label, value, icon, tone, detail }) {
  return <article className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong><span className="stat-detail">{detail}</span></article>
}

function ProjectsPage({ projects, search, onSearch, onOpenProject, canCreate, onCreate, projectModal, managers, busy, onCloseModal, onCreateProject }) {
  return (
    <>
      <div className="page-heading heading-row">
        <div><div className="eyebrow">PLAN AND TRACK</div><h1>{canCreate ? 'Projects' : 'My Projects'}</h1><p>Keep plans, people, and progress in one place.</p></div>
        {canCreate && <button className="button button-primary" onClick={onCreate}><span>＋</span> New project</button>}
      </div>
      <div className="toolbar"><label className="search-box"><span>⌕</span><input aria-label="Search projects" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search projects…" /></label><span className="result-count">{projects.length} {projects.length === 1 ? 'project' : 'projects'}</span></div>
      {projects.length ? <div className="projects-grid">{projects.map((project) => <ProjectCard key={project.id} project={project} onClick={() => onOpenProject(project)} />)}</div> : <EmptyState title="No matching projects" detail={search ? 'Try changing your search.' : 'Projects you can access will show up here.'} />}
      {projectModal && <Modal title="Create a project" onClose={onCloseModal}><ProjectForm managers={managers} busy={busy} onSubmit={onCreateProject} /></Modal>}
    </>
  )
}

function ProjectCard({ project, onClick }) {
  return (
    <button className="project-card" onClick={onClick}>
      <div className="project-card-top"><span className="project-symbol">✳</span><StatusPill value={PROJECT_STATUS[project.status]} /><span className="card-arrow">↗</span></div>
      <h3>{project.name}</h3><p className="project-card-manager">Managed by {project.managerName}</p>
      <div className="project-card-meta"><span>◷ &nbsp;Due {formatDate(project.endDate)}</span><span>♙ &nbsp;{project.memberCount} members</span></div>
      <div className="project-progress-label"><span>Progress</span><strong>{project.progress}%</strong></div>
      <div className="progress-track"><span style={{ width: `${project.progress}%` }} /></div>
    </button>
  )
}

function ProjectRow({ project, onClick }) {
  return (
    <button className="project-row" onClick={onClick}>
      <span className="project-symbol">✳</span>
      <span className="row-project-name"><strong>{project.name}</strong><small>{project.managerName}</small></span>
      <span className="row-progress"><span className="progress-track"><span style={{ width: `${project.progress}%` }} /></span><small>{project.progress}%</small></span>
      <StatusPill value={PROJECT_STATUS[project.status]} />
      <span className="row-chevron">›</span>
    </button>
  )
}

function ProjectView({
  project, detail, tasks, stats, history, people, managers, teamLeads, teams, selectedTask, role, session, busy, projectLoading,
  canEditProject, onBack, onEditProject, onAddTask, onAddTeam, onAddMember, onOpenTask, onCloseTask, onAddMemberToProject,
  onRemoveMember, onCreateTask, onCreateTeam, onUpdateTeam, onUpdateTask, onReviewTask,
  onUploadTaskFile, onDownloadTaskFile, onUpdateProject, editProjectModal, taskModal, teamModal, memberModal, onCloseModal,
}) {
  const activeProject = project.status === 1
  const isAdmin = role === 'Admin'
  const canCreateTask = activeProject && role === 'TeamLead'
  const canManageTeam = activeProject && (role === 'Admin' || role === 'Manager')
  const memberIds = new Set((detail?.members || []).map((member) => member.userId))
  const availablePeople = people.filter((person) => !memberIds.has(person.id))
  const taskAssignees = [...new Map(teams.flatMap((team) => team.members)
    .filter((member) => member.isActive)
    .map((member) => [member.userId, member])).values()]

  return (
    <>
      <button className="back-link" onClick={onBack}>← &nbsp;All projects</button>
      <div className="page-heading project-detail-heading">
        <div><div className="eyebrow">PROJECT DETAILS</div><h1>{project.name}</h1><p>{detail?.description || 'No project description has been added.'}</p></div>
        <div className="project-heading-actions">{canEditProject && <button className="button button-secondary button-small" disabled={!detail} onClick={onEditProject}>Edit project</button>}<StatusPill value={PROJECT_STATUS[project.status]} /></div>
      </div>
      <section className={`detail-stat-grid ${role === 'Admin' ? 'admin-detail-stat-grid' : ''}`}>
        <StatCard label="Completion" value={`${stats?.progress ?? project.progress}%`} icon="◴" tone="green" detail="Tasks marked done" />
        <StatCard label={role === 'Admin' ? 'Members' : 'Team members'} value={stats?.memberCount ?? project.memberCount} icon="♙" tone="violet" detail={`Managed by ${project.managerName}`} />
        {role !== 'Admin' && <StatCard label="Files shared" value={stats?.fileCount ?? 0} icon="▤" tone="blue" detail="Project resources" />}
        <StatCard label="Target date" value={project.endDate ? formatDate(project.endDate) : '—'} icon="◷" tone="orange" detail="Project deadline" />
      </section>
      <section className={isAdmin ? 'admin-project-content' : 'content-grid detail-grid'}>
        <div className={isAdmin ? 'panel project-members-panel' : 'panel task-panel'}>
          {!isAdmin && <>
            <div className="panel-heading"><div><h2>Tasks</h2></div>{canCreateTask && <button className="button button-primary button-small" disabled={projectLoading} onClick={onAddTask}><span>＋</span> Add task</button>}</div>
            {projectLoading ? <div className="loading-state"><span className="spinner" />Loading project…</div> : <ProjectTaskList tasks={tasks} canCreateTask={canCreateTask} showFilters={role === 'TeamLead'} onOpenTask={onOpenTask} />}
          </>}
          <div className="team-section">
            <div className="subheading">
              <h3>{role === 'Admin' ? 'Project members' : 'Project team'}</h3><span>{detail?.members?.length || 0}</span>
              {canManageTeam && role === 'Manager' && <button className="text-button" disabled={projectLoading} onClick={onAddMember}>＋ Add employee</button>}
            </div>
            {detail?.members?.length ? <div className="member-list">{detail.members.map((member) => <div className="member-row" key={member.userId}><span className="avatar">{initials(member.fullName)}</span><span><strong>{member.fullName}</strong><small>{member.designation || member.email}</small></span><span className="member-date">{formatDate(member.joinedAt)}</span>{canManageTeam && <button className="text-button remove-member" onClick={() => onRemoveMember(member.userId)}>Remove</button>}</div>)}</div> : <p className="muted-copy">No members have been added to this project.</p>}
          </div>
          {(role === 'Manager' || role === 'TeamLead' || role === 'Employee') && <div className="team-section">
            <div className="subheading"><h3>Teams</h3><span>{teams.length}</span>{canManageTeam && role === 'Manager' && <button className="text-button" disabled={projectLoading} onClick={onAddTeam}>＋ Create team</button>}</div>
            {teams.length ? <div className="team-card-list">{teams.map((team) => <TeamSummaryCard key={team.id} team={team} canEdit={canManageTeam && role === 'Manager'} people={people} teamLeads={teamLeads} busy={busy} onUpdate={onUpdateTeam} onDownload={onDownloadTaskFile} />)}</div> : <p className="muted-copy">{canManageTeam && role === 'Manager' ? 'Create a team and assign a Team Lead and employees.' : 'No teams are assigned to you in this project.'}</p>}
          </div>}
        </div>
        {!isAdmin && <div className="panel activity-panel"><div className="panel-heading"><div><h2>Activity</h2><p>Recent project updates</p></div></div>
          {history.length ? <div className="activity-list">{history.slice(0, 8).map((item) => <div className="activity-item" key={item.id}><span className="activity-dot" /><div><p>{item.action}</p><small>{item.performedBy} · {formatDate(item.createdAt)}</small></div></div>)}</div> : <EmptyState title="No activity yet" detail="Updates will appear here as work happens." />}
        </div>}
      </section>
      {taskModal && canCreateTask && <Modal title="Add a task" onClose={onCloseModal}><TaskForm employees={taskAssignees} session={session} busy={busy} onSubmit={onCreateTask} /></Modal>}
      {teamModal && canManageTeam && role === 'Manager' && <Modal title="Create a team" onClose={onCloseModal}><TeamForm people={people} teamLeads={teamLeads} busy={busy} onSubmit={onCreateTeam} /></Modal>}
      {memberModal && canManageTeam && role === 'Manager' && <Modal title="Add employees" onClose={onCloseModal}><MemberForm people={availablePeople} busy={busy} onSubmit={onAddMemberToProject} /></Modal>}
      {editProjectModal && detail && <Modal title="Edit project" onClose={onCloseModal}><ProjectForm project={detail} managers={managers} busy={busy} onSubmit={onUpdateProject} /></Modal>}
      {!isAdmin && selectedTask && <TaskDetailsModal
        key={selectedTask.id}
        projectId={project.id}
        task={selectedTask}
        session={session}
        activeProject={activeProject}
        busy={busy}
        onClose={onCloseTask}
        onUpdate={onUpdateTask}
        onReview={onReviewTask}
        onUploadFile={onUploadTaskFile}
        onDownloadFile={onDownloadTaskFile}
      />}
    </>
  )
}

const EMPTY_TASK_FILTERS = { assignee: '', status: '', from: '', through: '' }

function ProjectTaskList({ tasks, canCreateTask, showFilters, onOpenTask }) {
  const [filters, setFilters] = useState(EMPTY_TASK_FILTERS)
  const hasFilters = Object.values(filters).some(Boolean)
  const assignees = [...new Map(tasks.map((task) => [String(task.assignedToId ?? 'unassigned'), task.assignedToName || 'Unassigned']))]
    .sort(([, first], [, second]) => first.localeCompare(second))
  const visibleTasks = showFilters && hasFilters ? tasks.filter((task) => {
    const deadline = task.dueDate?.slice(0, 10)
    return (!filters.assignee || filters.assignee === String(task.assignedToId ?? 'unassigned')) &&
      (!filters.status || Number(filters.status) === task.status) &&
      (!filters.from || (deadline && deadline >= filters.from)) &&
      (!filters.through || (deadline && deadline <= filters.through))
  }) : tasks

  function changeFilter(event) {
    const { name, value } = event.target
    setFilters((current) => ({ ...current, [name]: value }))
  }

  return <>
    {showFilters && tasks.length > 0 && <div className="form-stack task-filters" role="group" aria-label="Filter tasks">
      <label>Employee<select name="assignee" value={filters.assignee} onChange={changeFilter}>
        <option value="">All assignees</option>
        {assignees.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <label>Status<select name="status" value={filters.status} onChange={changeFilter}>
        <option value="">All statuses</option>
        {Object.entries(TASK_STATUS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      <label>Deadline from<input name="from" type="date" value={filters.from} max={filters.through || undefined} onChange={changeFilter} /></label>
      <label>Deadline through<input name="through" type="date" value={filters.through} min={filters.from || undefined} onChange={changeFilter} /></label>
      {hasFilters && <button className="text-button clear-task-filters" onClick={() => setFilters(EMPTY_TASK_FILTERS)}>Clear filters</button>}
    </div>}
    {visibleTasks.length ? <div className="task-list">{visibleTasks.map((task) => <TaskRow key={task.id} task={task} onOpen={() => onOpenTask(task.id)} />)}</div>
      : hasFilters ? <EmptyState title="No matching tasks" detail="Change or clear your filters." />
        : <EmptyState title="No tasks yet" detail={canCreateTask ? 'Add a task to get this project moving.' : ''} />}
  </>
}

function TaskRow({ task, onOpen }) {
  return (
    <button className="task-row task-row-button" onClick={onOpen}>
      <span className={`task-status-dot status-${task.status}`} />
      <span className="task-copy"><strong>{task.title}</strong><small>{task.assignedToName || 'Unassigned'} · {TASK_PRIORITY[task.priority] || 'Normal'} priority</small></span>
      <span className={`status-pill task-pill status-${task.status}`}>{TASK_STATUS[task.status]}</span>
      <span className="task-due">{formatTaskDate(task.dueDate)}</span>
      <span className="row-chevron">›</span>
    </button>
  )
}

function TeamSummaryCard({ team, canEdit, people, teamLeads, busy, onUpdate, onDownload }) {
  const [editing, setEditing] = useState(false)
  const [downloadError, setDownloadError] = useNotification()
  async function save(values) {
    const success = await onUpdate(team.id, values)
    if (success) setEditing(false)
  }
  async function download(file) {
    setDownloadError('')
    try {
      await onDownload(file)
    } catch (error) {
      setDownloadError(error.message)
    }
  }
  return (
    <article className="team-card">
      <div className="team-card-heading"><div><strong>{team.name}</strong><small>Led by {team.teamLeadName}</small></div>{canEdit && <button className="text-button" onClick={() => setEditing(true)}>Edit team</button>}</div>
      <div className="team-member-chips">{team.members.map((member) => <span className="team-member-chip" key={member.userId}>{member.fullName}</span>)}</div>
      <div className="team-progress-counts"><span>{team.totalTasks} tasks</span><span>{team.reviewTasks} in review</span><span>{team.completedTasks} completed</span><span>{team.overdueTasks} overdue</span></div>
      {!!team.resources.length && <div className="task-files">
        <strong>Shared resources</strong>
        {team.resources.map((file) => <div className="task-file" key={file.id}><span>▤</span><div><strong>{file.fileName}</strong></div><button className="text-button" onClick={() => download(file)}>Download</button></div>)}
        {downloadError && <p className="form-error" role="alert">{downloadError}</p>}
      </div>}
      {editing && <Modal title={`Edit ${team.name}`} onClose={() => setEditing(false)}><TeamForm team={team} people={people} teamLeads={teamLeads} busy={busy} onSubmit={save} /></Modal>}
    </article>
  )
}

function TeamForm({ people, teamLeads, busy, onSubmit, team }) {
  const [name, setName] = useState(team?.name || '')
  const [teamLeadId, setTeamLeadId] = useState(String(team?.teamLeadId || ''))
  const [employeeIds, setEmployeeIds] = useState(() => (team?.members || []).map((member) => member.userId))
  const [resources, setResources] = useState([])
  const [error, setError] = useNotification()
  const employees = [...new Map([...(team?.members || []).map((member) => ({ ...member, id: member.userId })),
    ...people].map((person) => [person.id, person])).values()]
  const leads = [...teamLeads]
  if (team && !leads.some((person) => person.id === team.teamLeadId))
    leads.unshift({ id: team.teamLeadId, fullName: team.teamLeadName })
  function toggleEmployee(id) {
    setEmployeeIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }
  function submit(event) {
    event.preventDefault()
    if (resources.some((file) => file.size === 0 || file.size > 20_000_000) ||
      resources.reduce((total, file) => total + file.size, 0) > 24_000_000) {
      setError('Choose nonempty files of up to 20 MB each and up to 24 MB total.')
      return
    }
    setError('')
    onSubmit({ name: name.trim(), teamLeadId: Number(teamLeadId), employeeIds, resources })
  }
  return <form className="form-stack" onSubmit={submit}>
    <label>Team name<input value={name} onChange={(event) => setName(event.target.value)} maxLength="120" required /></label>
    <label>Team Lead<select value={teamLeadId} onChange={(event) => setTeamLeadId(event.target.value)} required><option value="">{leads.length ? 'Select a Team Lead' : 'No Team Leads available'}</option>{leads.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}</select></label>
    <div><span className="field-label">Employees</span>{employees.length ? <div className="employee-picker" role="group" aria-label="Team employees">{employees.map((person) => <label className="employee-option" key={person.id}><input type="checkbox" checked={employeeIds.includes(person.id)} onChange={() => toggleEmployee(person.id)} /><span><strong>{person.fullName}</strong><small>{person.email}</small></span></label>)}</div> : <p className="muted-copy">No employees are available.</p>}</div>
    <label>{team ? 'Add resource files for the Team Lead' : 'Resource files for the Team Lead'}<input type="file" multiple onChange={(event) => setResources(Array.from(event.target.files))} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <FormActions busy={busy} disabled={!teamLeadId || !name.trim()} label={team ? 'Save team' : 'Create team'} />
  </form>
}

function TeamLeadDashboard({ stats, projects, tasks, userId, onOpenProject, onOpenTask }) {
  const cards = [
    ['Team Members', stats?.totalTeamMembers ?? 0, '♙', 'green'],
    ['Total Tasks', stats?.totalTasks ?? tasks.length, '✓', 'orange'],
    ['Pending Tasks', stats?.pendingTasks ?? 0, '◷', 'blue'],
    ['In Progress', stats?.inProgressTasks ?? 0, '↗', 'violet'],
    ['Awaiting Review', stats?.reviewTasks ?? 0, '◎', 'orange'],
    ['Completed', stats?.completedTasks ?? 0, '✓', 'green'],
    ['Overdue', stats?.overdueTasks ?? 0, '!', 'orange'],
  ]
  const reviewTasks = tasks.filter((task) => task.status === 4 && task.assignedToId !== userId)
  return (
    <>
      <div className="page-heading"><div><div className="eyebrow">TEAM LEAD DASHBOARD</div><h1>Your teams at a glance</h1><p>Coordinate your teams, assign work and review submitted tasks.</p></div></div>
      <section className="stat-grid team-lead-stat-grid" aria-label="Team Lead statistics">{cards.map(([label, value, icon, tone]) => <StatCard key={label} label={label} value={value} icon={icon} tone={tone} detail={label === 'Overdue' ? 'Past deadline' : 'Current workload'} />)}</section>
      <section className="content-grid">
        <div className="panel project-panel"><div className="panel-heading"><div><h2>My projects</h2><p>Projects with teams assigned to you</p></div></div>
          {projects.length ? <div className="project-list">{projects.map((project) => <ProjectRow key={project.id} project={project} onClick={() => onOpenProject(project)} />)}</div> : <EmptyState title="No assigned projects" detail="Projects assigned to your teams will appear here." />}
        </div>
        <div className="panel focus-panel"><div className="panel-heading"><div><h2>Review queue</h2><p>Submitted tasks needing your review</p></div><span className="snapshot-icon">↗</span></div>
          {reviewTasks.length ? <div className="task-list">{reviewTasks.slice(0, 5).map((task) => <TaskRow key={task.id} task={task} onOpen={() => onOpenTask(task)} />)}</div> : <EmptyState title="All caught up" detail="Tasks submitted by your team will appear here." />}
        </div>
      </section>
    </>
  )
}

function TeamLeadTasksPage({ tasks, onOpenTask }) {
  return (
    <>
      <div className="page-heading"><div><div className="eyebrow">REVIEW QUEUE</div><h1>Tasks awaiting review</h1></div></div>
      <div className="panel task-panel"><div className="task-list">
        {tasks.length ? tasks.map((task) => <TaskRow key={task.id} task={task} onOpen={() => onOpenTask(task)} />) : <EmptyState title="No tasks awaiting review" detail="Submitted tasks will show here." />}
      </div></div>
    </>
  )
}

function AccountMenu({ displayName, role, onProfile, onLogout, sidebar = false }) {
  const [open, setOpen] = useState(false)
  const menu = useRef(null)
  const trigger = useRef(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    function dismiss(event) {
      if (!menu.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  function handleEscape(event) {
    if (event.key !== 'Escape' || !open) return
    setOpen(false)
    trigger.current?.focus()
  }

  return <div className={sidebar ? 'account-menu sidebar-account-menu' : 'account-menu'} ref={menu} onKeyDown={handleEscape}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <button ref={trigger} type="button" className={sidebar ? 'profile-button' : 'avatar avatar-small account-avatar'}
      aria-label={`Account menu for ${displayName}`} aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen((current) => !current)}>
      {sidebar ? <><span className="avatar">{initials(displayName)}</span>
        <span className="profile-text"><strong>{displayName}</strong><small>{ROLE_NAMES[role]}</small></span></>
        : initials(displayName)}
    </button>
    {open && <div className="account-options" id={menuId}>
      <button type="button" onClick={() => { setOpen(false); onProfile() }}>Profile</button>
      <button type="button" onClick={() => { setOpen(false); onLogout() }}>Log out</button>
    </div>}
  </div>
}

function ProfilePage({ session, displayName }) {
  const [busy, setBusy] = useState(false)
  const [profile, setProfile] = useState(null)
  const [error, setError] = useNotification()
  const [notice, setNotice] = useNotification()

  useEffect(() => {
    const controller = new AbortController()
    api('/auth/profile', { token: session.token, signal: controller.signal })
      .then((rows) => { if (!controller.signal.aborted) setProfile(rows) })
      .catch((requestError) => { if (!controller.signal.aborted) setError(requestError.message) })
    return () => controller.abort()
  }, [session.token, setError])

  async function changePassword(event) {
    event.preventDefault()
    const form = event.currentTarget
    const { currentPassword, newPassword, confirmPassword } = Object.fromEntries(new FormData(form))
    setError('')
    setNotice('')
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.')
      return
    }
    setBusy(true)
    try {
      await api('/auth/password', { token: session.token, method: 'PUT', body: jsonBody({ currentPassword, newPassword }) })
      form.reset()
      setNotice('Password changed.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  return <>
    <div className="page-heading"><h1>Profile</h1></div>
    <section className="panel profile-card">
      <span className="avatar">{initials(displayName)}</span>
      <div>
        <h2>{session.role === 'Admin' ? displayName : profile?.fullName || displayName}</h2>
        <p>{profile?.email || session.email}</p>
        <dl className="profile-details">
          <div><dt>Role</dt><dd>{ROLE_NAMES[profile?.role ?? session.role]}</dd></div>
          <div><dt>Designation</dt><dd>{profile?.designation || '—'}</dd></div>
        </dl>
      </div>
    </section>
    <section className="panel password-panel">
      <h2>Change password</h2>
      <form className="form-stack" onSubmit={changePassword}>
        <label>Current password<input type="password" name="currentPassword" autoComplete="current-password" required /></label>
        <label>New password<input type="password" name="newPassword" autoComplete="new-password" minLength={8} required /></label>
        <label>Confirm new password<input type="password" name="confirmPassword" autoComplete="new-password" required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="alert alert-success" role="status">{notice}</p>}
        <FormActions busy={busy} label="Change password" />
      </form>
    </section>
  </>
}

function TaskDetailsModal({ projectId, task, session, activeProject, busy, onClose, onUpdate, onReview, onUploadFile, onDownloadFile }) {
  const [files, setFiles] = useState(null)
  const [filesError, setFilesError] = useNotification()
  const [fileBusy, setFileBusy] = useState(false)
  const [fileError, setFileError] = useNotification()
  const { id, role, token } = session
  const isManager = role === 'Manager'
  const isTeamLead = role === 'TeamLead'
  const isEmployee = role === 'Employee' && task.assignedToId === id
  const isAssignedLead = isTeamLead && task.assignedToId === id
  const canWork = activeProject && (isEmployee || isAssignedLead)
  const canReview = activeProject && (isManager || (isTeamLead && !isAssignedLead)) && task.status === 4

  useEffect(() => {
    let active = true
    api(`/projects/${projectId}/files?taskId=${task.id}`, { token })
      .then((rows) => { if (active) { setFiles(rows); setFilesError('') } })
      .catch((requestError) => { if (active) setFilesError(requestError.message) })
    return () => { active = false }
  }, [projectId, setFilesError, task.id, token])

  async function uploadFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setFileBusy(true)
    setFileError('')
    const success = await onUploadFile(task.id, file)
    if (success) {
      try {
        setFiles(await api(`/projects/${projectId}/files?taskId=${task.id}`, { token }))
        setFilesError('')
      } catch (requestError) {
        setFilesError(requestError.message)
      }
    }
    event.target.value = ''
    setFileBusy(false)
  }

  async function download(file) {
    setFileError('')
    try {
      await onDownloadFile(file)
    } catch (requestError) {
      setFileError(requestError.message)
    }
  }

  return (
    <Modal title="Task details" onClose={onClose}>
      <div className="task-detail">
        <div className="task-detail-title"><h3>{task.title}</h3><StatusPill value={TASK_STATUS[task.status]} /></div>
        <div className="task-detail-meta">
          <span><strong>Assigned to</strong>{task.assignedToName || 'Unassigned'}</span>
          <span><strong>Priority</strong>{TASK_PRIORITY[task.priority] || 'Normal'}</span>
          {task.startDate && <span><strong>Start date</strong>{formatTaskDate(task.startDate)}</span>}
          <span><strong>Deadline</strong>{formatTaskDate(task.dueDate)}</span>
          {task.teamName && <span><strong>Team</strong>{task.teamName}</span>}
        </div>
        {task.description && <p className="task-description">{task.description}</p>}

        {canWork && task.status === 1 && <button className="button button-primary task-action" disabled={busy} onClick={() => onUpdate(task.id, 2)}>Start task</button>}
        {canWork && task.status === 2 && <button className="button button-primary task-action" disabled={busy} onClick={() => onUpdate(task.id, 4)}>Submit for review</button>}
        {canWork && task.status === 4 && <p className="review-message">{isAssignedLead ? 'Submitted for Project Manager review.' : 'Submitted for review.'}</p>}
        {canReview && <div className="table-actions"><button className="approve-button" disabled={busy} onClick={() => onReview(task.id, { approve: true })}>Approve</button><button className="reject-button" disabled={busy} onClick={() => onReview(task.id, { approve: false })}>Return for changes</button></div>}

        <section className="deliverables-section">
          <div className="subheading"><h3>Deliverables</h3><span>{files?.length ?? '…'}</span></div>
          {filesError && <p className="alert alert-error">{filesError}</p>}
          {fileError && <p className="alert alert-error">{fileError}</p>}
          {files === null ? <p className="muted-copy">Loading files…</p> : files.length ? <div className="task-files">{files.map((file) => <div className="task-file" key={file.id}><span>▤</span><div><strong>{file.fileName}</strong><small>{file.uploadedBy} · {formatDate(file.uploadedAt)}</small></div><button className="text-button" onClick={() => download(file)}>Download</button></div>)}</div> : <p className="muted-copy">No deliverables uploaded.</p>}
          {activeProject && (isEmployee || isTeamLead) && <label className="file-upload">Upload deliverable<input type="file" disabled={fileBusy || busy} onChange={uploadFile} /></label>}
        </section>
      </div>
    </Modal>
  )
}

function TeamPage({ people, onCreate, userModal, busy, onCloseModal, onCreateUser, onToggleActive, onEdit, editingPerson, onCloseEdit, onUpdateUser }) {
  const [roleFilter, setRoleFilter] = useState('all')
  const filteredPeople = people.filter((person) => roleFilter === 'all' || String(person.role) === roleFilter)
  return (
    <>
      <div className="page-heading heading-row"><div><div className="eyebrow">PEOPLE AND PERMISSIONS</div><h1>Employee Management</h1><p>Manage workspace accounts and roles.</p></div><button className="button button-primary" onClick={onCreate}><span>＋</span> Add member</button></div>
      <div className="panel table-panel"><div className="table-heading directory-heading"><div><h2>Workspace members</h2><p>{filteredPeople.length} of {people.length} people in your directory</p></div><label className="role-filter">Filter by role<select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="all">All roles</option><option value="1">Admin</option><option value="2">Project Manager</option><option value="4">Team Lead</option><option value="3">Employee</option></select></label></div>
        <div className="table-wrap table-responsive"><table className="table table-hover align-middle mb-0"><thead><tr><th>Member</th><th>Role</th><th>Designation</th><th>Status</th><th>Actions</th></tr></thead><tbody>{filteredPeople.map((person) => <tr key={person.id}><td><div className="table-person"><span className="avatar">{initials(person.role === 1 ? 'Admin' : person.fullName)}</span><span><strong>{person.role === 1 ? 'Admin' : person.fullName}</strong><small>{person.email}</small></span></div></td><td><span className="role-label">{ROLE_NAMES[person.role] || person.role}</span></td><td>{person.designation || '—'}</td><td><span className={`user-state ${person.isActive ? 'enabled' : 'disabled'}`}>{person.isActive ? 'Active' : 'Inactive'}</span></td><td><div className="table-actions"><button className="text-button" disabled={busy} onClick={() => onEdit(person)}>Edit</button><button className="text-button" disabled={busy} onClick={() => onToggleActive(person)}>{person.isActive ? 'Deactivate' : 'Activate'}</button></div></td></tr>)}</tbody></table></div>
      </div>
      {userModal && <Modal title="Add member" onClose={onCloseModal}><UserForm busy={busy} onSubmit={onCreateUser} /></Modal>}
      {editingPerson && <Modal title="Edit member" onClose={onCloseEdit}><UserForm person={editingPerson} busy={busy} onSubmit={(values) => onUpdateUser(editingPerson.id, values)} /></Modal>}
    </>
  )
}

function ProjectForm({ managers, busy, onSubmit, project }) {
  const [form, setForm] = useState(() => ({
    name: project?.name || '',
    description: project?.description || '',
    startDate: project?.startDate?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    endDate: project?.endDate?.slice(0, 10) || '',
    managerId: project?.managerId?.toString() || '',
    status: project?.status || 1,
  }))
  function submit(event) {
    event.preventDefault()
    onSubmit({ ...form, managerId: Number(form.managerId), endDate: form.endDate || null, status: Number(form.status) })
  }
  return <form className="form-stack" onSubmit={submit}><label>Project name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label><label>Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows="3" /></label><div className="form-row"><label>Start date<input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} required /></label><label>Target date<input type="date" min={form.startDate} value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label></div><label>Project manager<select value={form.managerId} onChange={(event) => setForm({ ...form, managerId: event.target.value })} required><option value="">Select a manager</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.fullName}</option>)}</select></label>{project && <label>Project status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="1">Active</option><option value="2">Completed</option><option value="3">On hold</option></select></label>}<FormActions busy={busy} label={project ? 'Save project' : 'Create project'} /></form>
}

function TaskForm({ employees, session, busy, onSubmit }) {
  const today = localDateString()
  const [form, setForm] = useState(() => ({ title: '', description: '', assignedToId: '', startDate: today, dueDate: '', priority: '2' }))
  function submit(event) {
    event.preventDefault()
    onSubmit({
      title: form.title,
      description: form.description || null,
      assignedToId: Number(form.assignedToId),
      startDate: form.startDate,
      dueDate: form.dueDate,
      priority: Number(form.priority),
    })
  }
  return <form className="form-stack" onSubmit={submit}>
    <label>Task title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Prepare project brief" required /></label>
    <label>Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows="3" maxLength="5000" /></label>
    <label>Assign to<select value={form.assignedToId} onChange={(event) => setForm({ ...form, assignedToId: event.target.value })} required><option value="">Select an assignee</option><option value={session.id}>{session.fullName} (you)</option>{employees.map((person) => <option key={person.userId} value={person.userId}>{person.fullName}</option>)}</select></label>
    <label>Priority<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option value="1">Low</option><option value="2">Normal</option><option value="3">High</option></select></label>
    <div className="form-row">
      <label>Start date<input type="date" max={form.dueDate || undefined} value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} required /></label>
      <label>Deadline<input type="date" min={form.startDate > today ? form.startDate : today} value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} required /></label>
    </div>
    <FormActions busy={busy} disabled={!form.assignedToId || !form.startDate || !form.dueDate} label="Create task" />
  </form>
}

function UserForm({ busy, onSubmit, person }) {
  const [form, setForm] = useState(() => ({
    fullName: person?.fullName || '',
    email: person?.email || '',
    password: '',
    role: String(person?.role || 3),
    designation: person?.designation || '',
    isActive: person?.isActive ?? true,
  }))
  function submit(event) {
    event.preventDefault()
    const role = Number(form.role)
    if (person) {
      onSubmit({ fullName: form.fullName, role, designation: form.designation || null, isActive: form.isActive, newPassword: form.password || null })
    } else {
      onSubmit({ fullName: form.fullName, email: form.email, password: form.password, role, designation: form.designation || null })
    }
  }
  return <form className="form-stack" onSubmit={submit}><label>Full name<input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required /></label>{!person && <label>Email address<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>}<div className="form-row"><label>Role<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="3">Employee</option><option value="4">Team Lead</option><option value="2">Project Manager</option>{person?.role === 1 && <option value="1">Admin</option>}</select></label><label>Designation<input value={form.designation} onChange={(event) => setForm({ ...form, designation: event.target.value })} /></label></div>{person && <label className="checkbox-label"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /> Active account</label>}<label>{person ? 'Reset password (optional)' : 'Temporary password'}<input type="password" minLength="8" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required={!person} /></label><FormActions busy={busy} label={person ? 'Save member' : 'Add member'} /></form>
}

function MemberForm({ people, busy, onSubmit }) {
  const [userIds, setUserIds] = useState([])
  function toggleUser(userId) {
    setUserIds((selected) => selected.includes(userId)
      ? selected.filter((id) => id !== userId)
      : [...selected, userId])
  }
  function submit(event) { event.preventDefault(); onSubmit(userIds) }
  return <form className="form-stack" onSubmit={submit}>
    {people.length ? <>
      <p className="muted-copy">Select one or more employees to add to this project.</p>
      <div className="employee-picker" role="group" aria-label="Available employees">
        {people.map((person) => <label className="employee-option" key={person.id}>
          <input type="checkbox" checked={userIds.includes(person.id)} onChange={() => toggleUser(person.id)} />
          <span><strong>{person.fullName}</strong><small>{person.email}</small></span>
        </label>)}
      </div>
      <FormActions busy={busy} disabled={!userIds.length} label={`Add ${userIds.length || ''} employee${userIds.length === 1 ? '' : 's'}`} />
    </> : <p className="muted-copy">There are no unassigned employees available.</p>}
  </form>
}

function FormActions({ busy, disabled = false, label = 'Save changes' }) {
  return <div className="form-actions"><button type="submit" className="button button-primary" disabled={busy || disabled}>{busy ? 'Saving…' : label}</button></div>
}

function Modal({ title, onClose, children }) {
  const titleId = useId()
  const feedback = useContext(ActionFeedback)
  function close() {
    feedback?.clearError()
    onClose()
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="modal-heading"><h2 id={titleId}>{title}</h2><button className="close-button" onClick={close} aria-label="Close dialog">×</button></div>
      {feedback?.error && <p className="alert alert-error" role="alert">{feedback.error}</p>}
      {feedback?.notice && <div className="alert alert-success" role="status"><span>{feedback.notice}</span><button onClick={feedback.clearNotice} aria-label="Dismiss message">×</button></div>}
      {children}
    </section>
  </div>
}

function StatusPill({ value }) {
  const className = value?.toLowerCase().replace(/\s+/g, '-') || 'unknown'
  return <span className={`status-pill ${className}`}>{value}</span>
}

function EmptyState({ title, detail }) {
  return <div className="empty-state"><span className="empty-icon">✳</span><strong>{title}</strong><p>{detail}</p></div>
}

export default App
