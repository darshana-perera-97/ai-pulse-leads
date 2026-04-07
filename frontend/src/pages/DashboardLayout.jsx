import { useMemo } from 'react';
import { useLocation, Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import TopBar from '../components/TopBar';
import RightRail from '../components/RightRail';

const TITLE_BY_SECTION = {
  analytics: 'Analytics',
  'search-leads': 'Search Leads',
  leads: 'Leads',
  messages: 'Messages',
  campaigns: 'Campaigns',
  integration: 'Integration',
  settings: 'Settings',
};

export default function DashboardLayout() {
  const location = useLocation();

  const pageTitle = useMemo(() => {
    const section = location.pathname.split('/').pop();
    return TITLE_BY_SECTION[section] || 'Dashboard';
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />

      <div className="ml-72 flex h-screen flex-col pt-16 box-border">
        <TopBar pageTitle={pageTitle} />

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mx-auto grid h-full min-h-0 w-full max-w-[1440px] grid-cols-12 gap-6 px-6 py-6">
            <section className="no-scrollbar col-span-12 min-h-0 overflow-y-auto overscroll-y-contain lg:col-span-9">
              <Outlet />
            </section>
            <section className="no-scrollbar col-span-12 hidden min-h-0 overflow-y-auto overscroll-y-contain lg:col-span-3 lg:block">
              <RightRail />
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

