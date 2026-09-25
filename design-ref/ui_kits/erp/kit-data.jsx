// Shared helpers for the Innovic ERP UI kit.
const { useState, useEffect, useRef } = React;

// Control icons come from the design system (one icon source).
function Icon(props) { return React.createElement(window.InnovicERPDesignSystem_4a2115.Icon, props); }

const KIT_SECTIONS = [
  { key: 'sales', label: 'Sales & CRM', groups: [
    { label: 'Entry', items: [{ label: 'SO Master', icon: '📋', page: 'so' }, { label: 'JWSO Master', icon: '🔧' }, { label: 'Customer Dispatch', icon: '🚚' }] },
    { label: 'Master', items: [{ label: 'Client Master', icon: '🏢' }] } ] },
  { key: 'design', label: 'Design', groups: [{ items: [{ label: 'Design Projects', icon: '📋' }, { label: 'Design Issues', icon: '⚠' }, { label: 'Daily Work Log', icon: '⏱' }, { label: 'BOM Master', icon: '📦' }, { label: 'Design Tracker', icon: '🎨' }, { label: 'Route Cards', icon: '🗒' }] }] },
  { key: 'planning', label: 'Planning', groups: [{ items: [{ label: 'SO/JWSO Planning', icon: '📋' }, { label: 'SO Overview', icon: '📊' }, { label: 'SO Status Review', icon: '📊' }, { label: 'Assembly Tracker', icon: '📦' }, { label: 'Plans', icon: '📋' }] }] },
  { key: 'production', label: 'Production', groups: [
    { label: 'Entry', items: [{ label: 'Create Production Order', icon: '🏭' }, { label: 'Op Entry', icon: '✚' }, { label: 'JC Operations', icon: '⨯' }, { label: 'Daily Report', icon: '📊' }, { label: 'Close Production Order', icon: '🔒' }] },
    { label: 'Master', items: [{ label: 'Plans Available for Production', icon: '📋' }, { label: 'Production Orders', icon: '🏭' }, { label: 'Job Cards', icon: '▭' }, { label: 'Machine Master', icon: '⚙' }, { label: 'Operator Master', icon: '👷' }, { label: 'Raw Material Master', icon: '▬' }] },
    { label: 'Report', items: [{ label: 'Production Dashboard', icon: '📊' }, { label: 'Live Operations', icon: '🔴', page: 'ops' }, { label: 'Job Queue', icon: '⬛' }, { label: 'Machine Loading', icon: '▣' }, { label: 'Production Schedule (Gantt)', icon: '📅' }] } ] },
  { key: 'purchase', label: 'Purchase', groups: [
    { label: 'Entry', items: [{ label: 'Purchase Requests', icon: '📄' }, { label: 'Purchase Orders', icon: '📋', page: 'po' }, { label: 'OSP Outward DC', icon: '🚛' }] },
    { label: 'Master', items: [{ label: 'Vendor Master', icon: '🚚' }] } ] },
  { key: 'qc', label: 'Quality', groups: [
    { items: [{ label: 'QC Call Register', icon: '📋' }, { label: 'QC Command Center', icon: '🔬' }, { label: 'Incoming QC', icon: '🔬' }, { label: 'QC Documents', icon: '🗃' }, { label: 'NC Register', icon: '⚠️' }] },
    { label: 'Master', items: [{ label: 'QC Process Master', icon: '⚙' }, { label: 'TPI Master', icon: '🔍' }] } ] },
  { key: 'store', label: 'Store', groups: [
    { label: 'Entry', items: [{ label: 'GRN (Goods Receipt)', icon: '📥' }, { label: 'Item Issue Register', icon: '📋' }, { label: 'Party Material', icon: '📥' }] },
    { label: 'Master', items: [{ label: 'Item Master', icon: '◉' }, { label: 'Party Material Master', icon: '🏭' }] },
    { label: 'Report', items: [{ label: 'Store / Inventory', icon: '📦' }] } ] },
  { key: 'finance', label: 'Finance', groups: [
    { label: 'Entry', items: [{ label: 'Invoices', icon: '📄' }] }, { label: 'Master', items: [{ label: 'Cost Center Master', icon: '🏢' }] },
    { label: 'Report', items: [{ label: 'SO Costing', icon: '💰' }, { label: 'Stock Valuation', icon: '📦' }] } ] },
  { key: 'tasks', label: 'Tasks', groups: [{ items: [{ label: 'Task Board', icon: '📋', page: 'tasks' }, { label: 'Daily Task Reports', icon: '📝' }, { label: 'Alerts', icon: '🔔' }, { label: 'Activity Log', icon: '📜' }] }] },
  { key: 'reports', label: 'Reports', groups: [{ items: [{ label: 'Reports', icon: '📊' }, { label: 'Saved Reports', icon: '✨' }, { label: 'Pending SO Value', icon: '💰' }, { label: 'Supply Chain Dashboard', icon: '🔗' }] }] },
  { key: 'system', label: 'Settings', groups: [{ items: [{ label: 'User Management', icon: '👥' }, { label: 'Access Control', icon: '🔒' }, { label: 'Approvals', icon: '✅' }, { label: 'Print Templates', icon: '📄' }, { label: 'Trash', icon: '🗑' }, { label: 'Settings', icon: '⚙' }] }] },
];

const KIT_ORDERS = [
  { id: 1, code: 'IN-SO-26-0142', date: '2026-09-18', type: 'Component', customer: 'Bharat Forge Ltd', cpo: '4500087121', lines: 3, qty: 120, jc: 120, disp: 40, due: '2026-09-30', status: 'open', by: 'Vinay K.', remarks: 'Urgent — line 2 first',
    items: [{ ln: 1, cpo: '10', code: 'BF-SH-2210/B', name: 'Pinion Shaft', qty: 60, jc: 60, disp: 40, due: '2026-09-26', status: 'open' }, { ln: 2, cpo: '20', code: 'BF-GR-1180/A', name: 'Spur Gear 42T', qty: 40, jc: 40, disp: 0, due: '2026-09-28', status: 'open' }, { ln: 3, cpo: '30', code: 'BF-SP-0402/0', name: 'Spacer Ring', qty: 20, jc: 20, disp: 0, due: '2026-09-30', status: 'open' }] },
  { id: 2, code: 'IN-SO-26-0139', date: '2026-09-02', type: 'Component', customer: 'Kirloskar Pneumatic Co.', cpo: 'KPC/PO/2291', lines: 2, qty: 40, jc: 24, disp: 0, due: '2026-09-12', status: 'open', by: 'Rahul M.', remarks: '—',
    items: [{ ln: 1, cpo: '1', code: 'KP-VH-0091/C', name: 'Valve Housing', qty: 24, jc: 24, disp: 0, due: '2026-09-12', status: 'open' }, { ln: 2, cpo: '2', code: 'KP-CV-0092/C', name: 'Cover Plate', qty: 16, jc: 0, disp: 0, due: '2026-09-15', status: 'open' }] },
  { id: 3, code: 'IN-SO-26-0136', date: '2026-08-27', type: 'Equipment', customer: 'Thermax Ltd', cpo: 'TX-44718', lines: 1, qty: 2, jc: 0, disp: 0, due: '2026-10-20', status: 'draft', by: 'Vinay K.', remarks: 'BOM awaited from design', bom: 'BOM Pending', items: [] },
  { id: 4, code: 'IN-SO-26-0131', date: '2026-08-11', type: 'Component', customer: 'Alfa Laval India', cpo: '7700120', lines: 4, qty: 300, jc: 300, disp: 300, due: '2026-09-05', status: 'closed', by: 'Sneha P.', remarks: '—', items: [] },
  { id: 5, code: 'IN-SO-26-0128', date: '2026-08-04', type: 'With Material', customer: 'Cummins India Ltd', cpo: 'CIL-9912', lines: 2, qty: 80, jc: 80, disp: 80, due: '2026-08-29', status: 'dispatched', by: 'Rahul M.', remarks: 'Party material — 80 blanks', items: [] },
];

Object.assign(window, { Icon, KIT_SECTIONS, KIT_ORDERS });
