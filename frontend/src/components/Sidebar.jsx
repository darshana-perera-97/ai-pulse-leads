import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { logout } from '../auth';

function IconBase({ children, className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

function ChartIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M3 3v18h18" />
      <path d="M7 14l2-2 3 3 5-7" />
    </IconBase>
  );
}

function SearchLeadsIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </IconBase>
  );
}

function LeadsIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </IconBase>
  );
}

function MessageIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
    </IconBase>
  );
}

function CampaignIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M14 10l7-7" />
      <path d="M9 21H3v-6" />
      <path d="M2 22l10-10" />
      <path d="M22 2l-7 7" />
    </IconBase>
  );
}

function IntegrationIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 2v4" />
      <path d="M12 18v4" />
      <path d="M4.93 4.93l2.83 2.83" />
      <path d="M16.24 16.24l2.83 2.83" />
      <path d="M2 12h4" />
      <path d="M18 12h4" />
      <path d="M4.93 19.07l2.83-2.83" />
      <path d="M16.24 7.76l2.83-2.83" />
      <circle cx="12" cy="12" r="3.2" />
    </IconBase>
  );
}

function SettingsIcon(props) {
  return (
    <IconBase {...props}>
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-1.41 3.41h-.2a1.65 1.65 0 0 0-1.55 1.1 2 2 0 0 1-3.77 0 1.65 1.65 0 0 0-1.55-1.1h-.2a2 2 0 0 1-1.41-3.41l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.1-1.55 2 2 0 0 1 0-3.77A1.65 1.65 0 0 0 4.6 8.1a1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 0 1 5.62 2.8h.2A1.65 1.65 0 0 0 7.37 1.7a2 2 0 0 1 3.77 0 1.65 1.65 0 0 0 1.55 1.1h.2a2 2 0 0 1 1.41 3.41l-.06.06A1.65 1.65 0 0 0 19.4 8.1c0 .7.43 1.32 1.1 1.55a2 2 0 0 1 0 3.77A1.65 1.65 0 0 0 19.4 15z" />
    </IconBase>
  );
}

const NAV_ITEMS = [
  { label: 'Analytics', to: '/dashboard/analytics', Icon: ChartIcon },
  {
    label: 'Search Leads',
    to: '/dashboard/search-leads',
    Icon: SearchLeadsIcon,
  },
  { label: 'Leads', to: '/dashboard/leads', Icon: LeadsIcon },
  { label: 'Messages', to: '/dashboard/messages', Icon: MessageIcon },
  { label: 'Campaigns', to: '/dashboard/campaigns', Icon: CampaignIcon },
  { label: 'Integration', to: '/dashboard/integration', Icon: IntegrationIcon },
  { label: 'Settings', to: '/dashboard/settings', Icon: SettingsIcon },
];

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  function isActivePath(to) {
    // Simple prefix match to keep parent section highlighted.
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  function onLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <aside className="fixed left-0 top-0 w-72 bg-white border-r border-gray-100 h-screen flex flex-col z-40">
      <div className="px-6 py-5 flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white flex items-center justify-center shadow-sm">
          <span className="font-bold text-sm">W</span>
        </div>
        <div className="leading-tight">
          <div className="text-xs font-semibold text-gray-500">WhatsApp Lead Flow</div>
          <div className="text-sm font-bold text-gray-900">WhatsApp Lead Flow</div>
        </div>
      </div>

      <div className="px-4 py-2 flex-1">
        <nav aria-label="Dashboard navigation">
          <ul className="space-y-2">
            {NAV_ITEMS.map(({ label, to, Icon }) => {
              const active = isActivePath(to);
              return (
              <li key={to}>
                <NavLink
                  to={to}
                  className={
                    active
                      ? 'group relative flex items-center gap-3 rounded-2xl bg-indigo-50 px-4 py-3.5 text-sm font-semibold text-indigo-700'
                      : 'group relative flex items-center gap-3 rounded-2xl px-4 py-3.5 text-sm font-medium text-gray-700 hover:bg-gray-50'
                  }
                  end={false}
                >
                  <span
                    className={
                      active
                        ? 'text-indigo-700'
                        : 'text-gray-400 group-hover:text-gray-600'
                    }
                  >
                    <Icon className="w-5 h-5" />
                  </span>
                  <span className="truncate">{label}</span>
                  {active ? (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-10 w-1 rounded-full bg-indigo-600" />
                  ) : null}
                </NavLink>
              </li>
              );
            })}
          </ul>
        </nav>
      </div>

      <div className="px-4 pb-3">
        <button
          type="button"
          onClick={onLogout}
          className="w-full rounded-2xl border border-gray-200 bg-white hover:bg-gray-50 px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm"
        >
          Logout
        </button>
      </div>

      <div className="px-6 pb-6 pt-2 text-xs text-gray-500">
        © {new Date().getFullYear()} WhatsApp Lead Flow
      </div>
    </aside>
  );
}

