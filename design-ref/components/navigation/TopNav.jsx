import React from 'react';
export function TopNav({ logoSrc, sections = [], activeKey, dashboardActive = false, openKey, onToggle, onDashboard, onPick, currentPage, right, initials = 'AD' }) {
  const [flip, setFlip] = React.useState(false);
  return <nav className="topnav">
    <span className="tn-logo">{logoSrc ? <img src={logoSrc} alt="Innovic" /> : <b style={{ fontFamily: 'var(--hfont)', fontSize: 'var(--fs-md)' }}>INNOVIC</b>}</span>
    <a className={'tn-item' + (dashboardActive ? ' active' : '')} onClick={onDashboard}>Dashboard</a>
    {sections.map((sec) => {
      const open = openKey === sec.key;
      return <div key={sec.key} className="tn-sec">
        <button type="button" className={'tn-item' + (open || activeKey === sec.key ? ' active' : '')} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setFlip(r.left + r.width / 2 > window.innerWidth / 2); onToggle && onToggle(sec.key); }}>
          {sec.label}<span className="tn-caret">▾</span>
        </button>
        {open ? <div className={'tn-menu' + (flip ? ' flip' : '')} role="menu">
          {sec.groups.map((g, gi) => <div key={gi} className="tn-col">
            {g.label ? <div className="tn-col-label">{g.label}</div> : null}
            {g.items.map((it) => <a key={it.label} className={'tn-link' + (currentPage === it.label ? ' on' : '')} onClick={() => onPick && onPick(sec.key, it)}>
              <span className="tn-link-icon">{it.icon}</span><span>{it.label}</span></a>)}
          </div>)}
        </div> : null}
      </div>;
    })}
    <div className="tn-right">{right}<span className="tn-avatar">{initials}</span></div>
  </nav>;
}
