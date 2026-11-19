import { useEffect, useMemo, useState } from 'react'
import { api, jsonBody } from './api'
import './App.css'

const PROJECT_STATUS = { 1: 'Active', 2: 'Completed', 3: 'On hold' }
const TASK_STATUS = { 1: 'To Do', 2: 'In Progress', 3: 'Completed', 4: 'In Review' }
const TASK_PRIORITY = { 1: 'Low', 2: 'Normal', 3: 'High' }
const ROLE_NAMES = { 1: 'Admin', 2: 'Manager', 3: 'Employee' }
const SESSION_KEY = 'novac-session'
const PREVIOUS_SESSION_KEY = 'nova-session'

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
  const [page, setPage] = useState('Overview')
  const [projects, setProjects] = useState([])
  const [summary, setSummary] = useState(null)
  const [people, setPeople] = useState([])
  const [managers, setManagers] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [projectData, setProjectData] = useState(null)
  const [tasks, setTasks] = useState([])
  const [history, setHistory] = useState([])
  const [projectStats, setProjectStats] = useState(null)
  const [projectLoadedId, setProjectLoadedId] = useState(null)
  const [selectedTaskId, setSelectedTaskId] = useState(null)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState('')
  const [editingPerson, setEditingPerson] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const role = session?.role

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
        setSelectedProject((current) => current ? projectRows.find((project) => project.id === current.id) || current : null)
        setSummary(dashboard)

        if (role === 'Admin') {
          const [users, managerRows] = await Promise.all([
            api('/users', { token: session.token }),
            api('/users/managers', { token: session.token }),
          ])
          if (!active) return
          setPeople(users)
          setManagers(managerRows)
        } else if (role === 'Manager') {
          const employees = await api('/users/employees', { token: session.token })
          if (!active) return
          setPeople(employees)
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
  }, [reload, role, session?.token])

  useEffect(() => {
    if (!session?.token || !selectedProject) {
      return
    }
    let active = true
    Promise.all([
      api(`/projects/${selectedProject.id}`, { token: session.token }),
      api(`/projects/${selectedProject.id}/tasks`, { token: session.token }),
      api(`/dashboard/project/${selectedProject.id}`, { token: session.token }),
      api(`/projects/${selectedProject.id}/history`, { token: session.token }),
    ]).then(([detail, taskRows, stats, historyRows]) => {
      if (!active) return
      setProjectData(detail)
      setTasks(taskRows)
      setProjectStats(stats)
      setHistory(historyRows)
      setProjectLoadedId(selectedProject.id)
    }).catch((requestError) => {
      if (active) setError(requestError.message)
    })
    return () => { active = false }
  }, [reload, selectedProject, session?.token])

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
    setPage('Overview')
  }

  async function perform(action, successMessage) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(successMessage)
      setModal('')
      setReload((value) => value + 1)
      return true
    } catch (requestError) {
      setError(requestError.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  if (!session) {
    return <LoginScreen onLogin={(result) => {
      localStorage.setItem(SESSION_KEY, JSON.stringify(result))
      setSession(result)
    }} />
  }

  const navItems = [
    { label: 'Overview', icon: '◫' },
    { label: 'Projects', icon: '▦' },
    ...(role === 'Admin' ? [{ label: 'Team', icon: '♙' }] : []),
  ]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setPage('Overview'); setSelectedProject(null) }}>
          <span className="brand-mark">N</span>
          <span>novac</span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button key={item.label} className={page === item.label && !selectedProject ? 'nav-item active' : 'nav-item'} onClick={() => { setPage(item.label); setSelectedProject(null) }}>
              <span className="nav-icon">{item.icon}</span>{item.label}
            </button>
          ))}
          <button className="nav-item mobile-signout" onClick={signOut} aria-label="Sign out">
            <span className="nav-icon">↪</span>Sign out
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button className="profile-button" onClick={signOut} aria-label={`Sign out ${session.fullName}`}>
            <span className="avatar">{initials(session.fullName)}</span>
            <span className="profile-text"><strong>{session.fullName}</strong><small>{role}</small></span>
            <span className="signout-icon" aria-label="Sign out">↪</span>
          </button>
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
            <span className="avatar avatar-small">{initials(session.fullName)}</span>
          </div>
        </header>

        <div className="page-content">
          {error && <div className="alert alert-error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
          {notice && <div className="alert alert-success" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss message">×</button></div>}
          {loading && !projects.length ? <div className="loading-state"><span className="spinner" />Loading your workspace…</div> : null}

          {selectedProject ? (
            <ProjectView
              project={selectedProject}
              detail={projectLoadedId === selectedProject.id ? projectData : null}
              tasks={projectLoadedId === selectedProject.id ? tasks : []}
              stats={projectLoadedId === selectedProject.id ? projectStats : null}
              history={projectLoadedId === selectedProject.id ? history : []}
              projectLoading={projectLoadedId !== selectedProject.id}
              people={people.filter((person) => person.role === 3 && person.isActive)}
              managers={managers}
              selectedTask={tasks.find((task) => task.id === selectedTaskId) || null}
              role={role}
              busy={busy}
              onBack={() => setSelectedProject(null)}
              canEditProject={role === 'Admin'}
              onEditProject={() => setModal('editProject')}
              onAddTask={() => setModal('task')}
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
              onUpdateProject={(values) => perform(() => api(`/projects/${selectedProject.id}`, {
                token: session.token, method: 'PUT', body: jsonBody(values),
              }), 'Project updated')}
              onUpdateTask={(taskId, status) => perform(() => api(`/projects/${selectedProject.id}/tasks/${taskId}/status`, {
                token: session.token, method: 'PUT', body: jsonBody({ status }),
              }), 'Task status updated')}
              onReviewTask={(taskId, values) => perform(() => api(`/projects/${selectedProject.id}/tasks/${taskId}/review`, {
                token: session.token, method: 'PUT', body: jsonBody(values),
              }), values.approve ? 'Task approved' : 'Task returned for changes')}
              onAddTaskComment={(taskId, content) => perform(() => api(`/projects/${selectedProject.id}/tasks/${taskId}/comments`, {
                token: session.token, method: 'POST', body: jsonBody({ content }),
              }), 'Comment added')}
              editProjectModal={modal === 'editProject'}
              taskModal={modal === 'task'}
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
          ) : page === 'Projects' ? (
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
          ) : page === 'Team' ? (
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
  )
}

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
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
        <button className="button button-secondary" onClick={() => onNavigate('Projects')}>View all projects <span>→</span></button>
      </div>
      <section className="stat-grid" aria-label="Workspace statistics">
        <StatCard label="Total projects" value={projects.length} icon="▦" tone="blue" detail={`${active} currently active`} />
        <StatCard label={role === 'Employee' ? 'Assigned tasks' : role === 'Manager' ? 'Tasks in progress' : 'Team members'} value={role === 'Employee' ? totalTasks : role === 'Manager' ? (taskCounts.find((item) => item.label === 'InProgress')?.value || 0) : summary?.totalUsers ?? '—'} icon={role === 'Employee' || role === 'Manager' ? '✓' : '♙'} tone="violet" detail={role === 'Admin' ? 'Active members' : role === 'Manager' ? 'Across your projects' : 'Across your projects'} />
        <StatCard label="Average progress" value={`${progress}%`} icon="◴" tone="green" detail="Across visible projects" />
        <StatCard label="Tasks in review" value={reviewTasks} icon="↗" tone="orange" detail={role === 'Employee' ? 'Submitted for review' : 'Awaiting manager review'} />
      </section>
      <section className="content-grid">
        <div className="panel project-panel">
          <div className="panel-heading"><div><h2>Recent projects</h2><p>A quick look at work in motion</p></div><button className="text-button" onClick={() => onNavigate('Projects')}>See all <span>→</span></button></div>
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
        <div><div className="eyebrow">PLAN AND TRACK</div><h1>Projects</h1><p>Keep plans, people, and progress in one place.</p></div>
        {canCreate && <button className="button button-primary" onClick={onCreate}><span>＋</span> New project</button>}
      </div>
      <div className="toolbar"><label className="search-box"><span>⌕</span><input aria-label="Search projects" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search projects…" /></label><span className="result-count">{projects.length} {projects.length === 1 ? 'project' : 'projects'}</span></div>
      {projects.length ? <div className="projects-grid">{projects.map((project) => <ProjectCard key={project.id} project={project} onClick={() => onOpenProject(project)} />)}</div> : <EmptyState title="No matching projects" detail="Try changing your search or create a new project." />}
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
  project, detail, tasks, stats, history, people, managers, selectedTask, role, busy, projectLoading,
  canEditProject, onBack, onEditProject, onAddTask, onAddMember, onOpenTask, onCloseTask, onAddMemberToProject,
  onRemoveMember, onCreateTask, onUpdateTask, onReviewTask, onAddTaskComment,
  onUpdateProject, editProjectModal, taskModal, memberModal, onCloseModal,
}) {
  const canCreateTask = role === 'Manager'
  const canManageTeam = role === 'Admin' || role === 'Manager'
  const memberIds = new Set((detail?.members || []).map((member) => member.userId))
  const availablePeople = people.filter((person) => !memberIds.has(person.id))
  const projectPeople = people.filter((person) => memberIds.has(person.id))

  return (
    <>
      <button className="back-link" onClick={onBack}>← &nbsp;All projects</button>
      <div className="page-heading project-detail-heading">
        <div><div className="eyebrow">PROJECT DETAILS</div><h1>{project.name}</h1><p>{detail?.description || 'No project description has been added.'}</p></div>
        <div className="project-heading-actions">{canEditProject && <button className="button button-secondary button-small" disabled={!detail} onClick={onEditProject}>Edit project</button>}<StatusPill value={PROJECT_STATUS[project.status]} /></div>
      </div>
      <section className={`detail-stat-grid ${role === 'Admin' ? 'admin-detail-stat-grid' : ''}`}>
        <StatCard label="Completion" value={`${stats?.progress ?? project.progress}%`} icon="◴" tone="green" detail="Tasks marked done" />
        <StatCard label="Team members" value={stats?.memberCount ?? project.memberCount} icon="♙" tone="violet" detail={`Managed by ${project.managerName}`} />
        {role !== 'Admin' && <StatCard label="Files shared" value={stats?.fileCount ?? 0} icon="▤" tone="blue" detail="Project resources" />}
        <StatCard label="Target date" value={project.endDate ? formatDate(project.endDate) : '—'} icon="◷" tone="orange" detail="Project deadline" />
      </section>
      <section className="content-grid detail-grid">
        <div className="panel task-panel">
          <div className="panel-heading"><div><h2>Tasks</h2><p>Track the next steps for this project</p></div>{canCreateTask && <button className="button button-primary button-small" disabled={projectLoading} onClick={onAddTask}><span>＋</span> Add task</button>}</div>
          {projectLoading ? <div className="loading-state"><span className="spinner" />Loading project…</div> : tasks.length ? <div className="task-list">{tasks.map((task) => <TaskRow key={task.id} task={task} onOpen={() => onOpenTask(task.id)} />)}</div> : <EmptyState title="No tasks yet" detail={canCreateTask ? 'Add a task to get this project moving.' : 'Tasks assigned to you will show here.'} />}
          <div className="team-section">
            <div className="subheading">
              <h3>Project team</h3><span>{detail?.members?.length || 0}</span>
              {role === 'Manager' && <button className="text-button" disabled={projectLoading} onClick={onAddMember}>＋ Add employee</button>}
            </div>
            {detail?.members?.length ? <div className="member-list">{detail.members.map((member) => <div className="member-row" key={member.userId}><span className="avatar">{initials(member.fullName)}</span><span><strong>{member.fullName}</strong><small>{member.designation || member.email}</small></span><span className="member-date">{formatDate(member.joinedAt)}</span>{canManageTeam && <button className="text-button remove-member" onClick={() => onRemoveMember(member.userId)}>Remove</button>}</div>)}</div> : <p className="muted-copy">No team members have been added to this project.</p>}
          </div>
        </div>
        <div className="panel activity-panel"><div className="panel-heading"><div><h2>Activity</h2><p>Recent project updates</p></div></div>
          {history.length ? <div className="activity-list">{history.slice(0, 8).map((item) => <div className="activity-item" key={item.id}><span className="activity-dot" /><div><p>{item.action}</p><small>{item.performedBy} · {formatDate(item.createdAt)}</small></div></div>)}</div> : <EmptyState title="No activity yet" detail="Updates will appear here as work happens." />}
        </div>
      </section>
      {taskModal && <Modal title="Add a task" onClose={onCloseModal}><TaskForm people={projectPeople} busy={busy} onSubmit={onCreateTask} /></Modal>}
      {memberModal && role === 'Manager' && <Modal title="Add employees" onClose={onCloseModal}><MemberForm people={availablePeople} busy={busy} onSubmit={onAddMemberToProject} /></Modal>}
      {editProjectModal && detail && <Modal title="Edit project" onClose={onCloseModal}><ProjectForm project={detail} managers={managers} busy={busy} onSubmit={onUpdateProject} /></Modal>}
      {selectedTask && <TaskDetailsModal
        key={selectedTask.id}
        projectId={project.id}
        task={selectedTask}
        role={role}
        busy={busy}
        onClose={onCloseTask}
        onUpdate={onUpdateTask}
        onReview={onReviewTask}
        onAddComment={onAddTaskComment}
      />}
    </>
  )
}

function TaskRow({ task, onOpen }) {
  return (
    <button className="task-row task-row-button" onClick={onOpen}>
      <span className={`task-status-dot status-${task.status}`} />
      <span className="task-copy"><strong>{task.title}</strong><small>{task.assignedToName || 'Unassigned'} · {TASK_PRIORITY[task.priority] || 'Normal'} priority</small></span>
      <span className={`status-pill task-pill status-${task.status}`}>{TASK_STATUS[task.status]}</span>
      <span className="task-due">{task.dueDate ? formatDate(task.dueDate) : 'No due date'}</span>
      <span className="row-chevron">›</span>
    </button>
  )
}

function TaskDetailsModal({ projectId, task, role, busy, onClose, onUpdate, onReview, onAddComment }) {
  const [comments, setComments] = useState(null)
  const [commentsError, setCommentsError] = useState('')
  const [comment, setComment] = useState('')
  const [reviewNote, setReviewNote] = useState('')
  const token = readSession()?.token
  const isManager = role === 'Manager'
  const isEmployee = role === 'Employee' && task.assignedToId === readSession()?.id

  useEffect(() => {
    let active = true
    api(`/projects/${projectId}/tasks/${task.id}/comments`, { token })
      .then((rows) => { if (active) { setComments(rows); setCommentsError('') } })
      .catch((requestError) => { if (active) setCommentsError(requestError.message) })
    return () => { active = false }
  }, [projectId, task.id, token])

  async function submitComment(event) {
    event.preventDefault()
    if (!comment.trim()) return
    const success = await onAddComment(task.id, comment.trim())
    if (!success) return
    setComment('')
    const updated = await api(`/projects/${projectId}/tasks/${task.id}/comments`, { token })
    setComments(updated)
    setCommentsError('')
  }

  async function review(approve) {
    const success = await onReview(task.id, { approve, comment: reviewNote.trim() || null })
    if (success) setReviewNote('')
  }

  return (
    <Modal title="Task details" onClose={onClose}>
      <div className="task-detail">
        <div className="task-detail-title"><h3>{task.title}</h3><StatusPill value={TASK_STATUS[task.status]} /></div>
        <div className="task-detail-meta">
          <span><strong>Assigned to</strong>{task.assignedToName || 'Unassigned'}</span>
          <span><strong>Priority</strong>{TASK_PRIORITY[task.priority] || 'Normal'}</span>
          <span><strong>Due date</strong>{formatDate(task.dueDate)}</span>
        </div>

        {isEmployee && task.status === 1 && <button className="button button-primary task-action" disabled={busy} onClick={() => onUpdate(task.id, 2)}>Start task</button>}
        {isEmployee && task.status === 2 && <button className="button button-primary task-action" disabled={busy} onClick={() => onUpdate(task.id, 4)}>Submit for review</button>}
        {isEmployee && task.status === 4 && <p className="review-message">Submitted for your project manager’s review.</p>}
        {isManager && task.status === 4 && <div className="review-controls"><label>Review note (optional)<textarea rows="2" maxLength="2000" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /></label><div className="table-actions"><button className="approve-button" disabled={busy} onClick={() => review(true)}>Approve</button><button className="reject-button" disabled={busy} onClick={() => review(false)}>Return for changes</button></div></div>}

        <section className="comments-section">
          <div className="subheading"><h3>Comments</h3><span>{comments?.length ?? '…'}</span></div>
          {commentsError ? <p className="alert alert-error">{commentsError}</p> : comments === null ? <p className="muted-copy">Loading comments…</p> : comments.length ? <div className="comments-list">{comments.map((item) => <article className="comment-item" key={item.id}><div className="comment-heading"><strong>{item.authorName}</strong><small>{formatDate(item.createdAt)}</small></div><p>{item.content}</p></article>)}</div> : <p className="muted-copy">No comments yet.</p>}
          <form className="comment-form" onSubmit={submitComment}><textarea rows="2" maxLength="2000" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Write a comment…" required /><button className="button button-primary button-small" disabled={busy || !comment.trim()}>Comment</button></form>
        </section>
      </div>
    </Modal>
  )
}

function TeamPage({ people, onCreate, userModal, busy, onCloseModal, onCreateUser, onToggleActive, onEdit, editingPerson, onCloseEdit, onUpdateUser }) {
  return (
    <>
      <div className="page-heading heading-row"><div><div className="eyebrow">PEOPLE AND PERMISSIONS</div><h1>Your team</h1><p>Manage workspace accounts and roles.</p></div><button className="button button-primary" onClick={onCreate}><span>＋</span> Add member</button></div>
      <div className="panel table-panel"><div className="table-heading"><div><h2>Workspace members</h2><p>{people.length} people in your directory</p></div></div>
        <div className="table-wrap table-responsive"><table className="table table-hover align-middle mb-0"><thead><tr><th>Member</th><th>Role</th><th>Designation</th><th>Status</th><th>Actions</th></tr></thead><tbody>{people.map((person) => <tr key={person.id}><td><div className="table-person"><span className="avatar">{initials(person.fullName)}</span><span><strong>{person.fullName}</strong><small>{person.email}</small></span></div></td><td><span className="role-label">{ROLE_NAMES[person.role] || person.role}</span></td><td>{person.designation || '—'}</td><td><span className={`user-state ${person.isActive ? 'enabled' : 'disabled'}`}>{person.isActive ? 'Active' : 'Inactive'}</span></td><td><div className="table-actions"><button className="text-button" disabled={busy} onClick={() => onEdit(person)}>Edit</button><button className="text-button" disabled={busy} onClick={() => onToggleActive(person)}>{person.isActive ? 'Deactivate' : 'Activate'}</button></div></td></tr>)}</tbody></table></div>
      </div>
      {userModal && <Modal title="Add a team member" onClose={onCloseModal}><UserForm busy={busy} onSubmit={onCreateUser} /></Modal>}
      {editingPerson && <Modal title="Edit team member" onClose={onCloseEdit}><UserForm person={editingPerson} busy={busy} onSubmit={(values) => onUpdateUser(editingPerson.id, values)} /></Modal>}
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

function TaskForm({ people, busy, onSubmit }) {
  const [form, setForm] = useState({ title: '', assignedToId: '', dueDate: '' })
  const employees = people.filter((person) => person.role === 3 && person.isActive)
  const today = localDateString()
  function submit(event) { event.preventDefault(); onSubmit({ title: form.title, assignedToId: form.assignedToId ? Number(form.assignedToId) : null, dueDate: form.dueDate || null }) }
  return <form className="form-stack" onSubmit={submit}><label>Task title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Prepare project brief" required /></label><label>Assign to<select value={form.assignedToId} onChange={(event) => setForm({ ...form, assignedToId: event.target.value })}><option value="">Unassigned</option>{employees.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}</select></label><label>Deadline<input type="date" min={today} value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></label><FormActions busy={busy} label="Create task" /></form>
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
  return <form className="form-stack" onSubmit={submit}><label>Full name<input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required /></label>{!person && <label>Email address<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>}<div className="form-row"><label>Role<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="3">Employee</option><option value="2">Manager</option>{person?.role === 1 && <option value="1">Admin</option>}</select></label><label>Designation<input value={form.designation} onChange={(event) => setForm({ ...form, designation: event.target.value })} /></label></div>{person && <label className="checkbox-label"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /> Active account</label>}<label>{person ? 'Reset password (optional)' : 'Temporary password'}<input type="password" minLength="8" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required={!person} /></label><FormActions busy={busy} label={person ? 'Save member' : 'Add member'} /></form>
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
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><h2 id="modal-title">{title}</h2><button className="close-button" onClick={onClose} aria-label="Close dialog">×</button></div>{children}</section></div>
}

function StatusPill({ value }) {
  const className = value?.toLowerCase().replace(/\s+/g, '-') || 'unknown'
  return <span className={`status-pill ${className}`}>{value}</span>
}

function EmptyState({ title, detail }) {
  return <div className="empty-state"><span className="empty-icon">✳</span><strong>{title}</strong><p>{detail}</p></div>
}

export default App
