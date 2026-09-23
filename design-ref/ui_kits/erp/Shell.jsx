// App shell: TopNav + open-page tabs + breadcrumb, then scrolling #content.
function Shell({ page, setPage, tabs, setTabs, onSignOut, children }) {
  const NS = window.InnovicERPDesignSystem_4a2115;
  const { TopNav, PageTabs, Breadcrumbs, SearchInput, SyncDot } = NS;
  const [openKey, setOpenKey] = useState(null);
  const navRef = useRef(null);
  useEffect(() => {
    if (!openKey) return;
    const down = (e) => { if (navRef.current && !navRef.current.contains(e.target)) setOpenKey(null); };
    const key = (e) => { if (e.key === 'Escape') setOpenKey(null); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [openKey]);

  const H = { label: 'Home', link: true };
  const META = { home: { label: 'Dashboard', icon: '📊', crumbs: [{ label: 'Home' }] },
    so: { label: 'SO Master', icon: '📋', sec: 'sales', crumbs: [H, { label: 'Sales & CRM' }, { label: 'SO Master' }] },
    'so-new': { label: 'SO Master', icon: '📋', sec: 'sales', tab: 'so', crumbs: [H, { label: 'Sales & CRM' }, { label: 'SO Master', link: true }, { label: 'New' }] },
    'so-detail': { label: 'SO Master', icon: '📋', sec: 'sales', tab: 'so', crumbs: [H, { label: 'Sales & CRM' }, { label: 'SO Master', link: true }, { label: 'Detail' }] },
    ops: { label: 'Live Operations', icon: '🔴', sec: 'production', crumbs: [H, { label: 'Production' }, { label: 'Live Operations' }] },
    tasks: { label: 'Task Board', icon: '📋', sec: 'tasks', crumbs: [H, { label: 'Tasks & Alerts' }, { label: 'Task Board' }] },
    po: { label: 'Purchase Orders', icon: '📋', sec: 'purchase', crumbs: [H, { label: 'Purchase' }, { label: 'Purchase Orders', link: true }, { label: 'New' }] } };
  const tabKey = META[page].tab || page;
  const go = (p) => { setPage(p); const k = META[p].tab || p; if (!tabs.includes(k)) setTabs([...tabs, k]); };

  return <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
    <header style={{ flexShrink: 0, background: 'var(--bg2)', paddingBottom: 4 }} ref={navRef}>
      <TopNav logoSrc={(window.__resources && window.__resources.logo) || '../../assets/innovic-logo.jpeg'} sections={KIT_SECTIONS} activeKey={META[page].sec}
        dashboardActive={page === 'home'} openKey={openKey} onDashboard={() => { setOpenKey(null); go('home'); }}
        onToggle={(k) => setOpenKey(openKey === k ? null : k)} currentPage={META[tabKey].label}
        onPick={(s, it) => { if (it.page) go(it.page); }}
        right={<>
          <SearchInput width={190} placeholder="Search anything… (Ctrl+K)" />
          <SyncDot />
          <button type="button" className="btn btn-ghost btn-sm tn-iconbtn" title="Change your password"><Icon name="key-round" /></button>
          <button type="button" className="btn btn-ghost btn-sm tn-iconbtn" title="Sign out" onClick={onSignOut}><Icon name="log-out" /></button>
        </>} initials="VK" />
      <PageTabs tabs={tabs.map((k) => ({ key: k, label: META[k].label, icon: META[k].icon }))} activeKey={tabKey}
        onSelect={(k) => setPage(k)} onClose={(k) => { const rest = tabs.filter((t) => t !== k); setTabs(rest.length ? rest : ['home']); if (k === tabKey) setPage(rest[0] || 'home'); }} />
      <Breadcrumbs crumbs={META[page].crumbs} onNavigate={(c) => c.label === 'Home' ? go('home') : go(tabKey)} />
    </header>
    <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>{children}</div>
  </div>;
}
window.Shell = Shell;
