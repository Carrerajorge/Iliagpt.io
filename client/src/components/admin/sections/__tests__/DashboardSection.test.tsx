import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardSection } from '../DashboardSection';

// Mock dashboard data
const mockDashboardData = {
  users: { total: 1250, active: 800, newThisMonth: 45 },
  aiModels: { total: 12, active: 8 },
  payments: { total: '15000.50', thisMonth: '3200.00', count: 156 },
  invoices: { total: 89, pending: 12, paid: 77 },
  analytics: { totalQueries: 45000, avgQueriesPerUser: 36 },
  database: { tables: 24, status: 'healthy' },
  security: { alerts: 0, status: 'healthy' },
  reports: { total: 15, scheduled: 5 },
  settings: { total: 48, categories: 8 },
  systemHealth: { xai: true, gemini: true, uptime: 99.95 },
  recentActivity: [
    { action: 'User signup', createdAt: new Date().toISOString() },
    { action: 'Payment received', createdAt: new Date().toISOString() },
  ],
};

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = createTestQueryClient();
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        {ui}
      </QueryClientProvider>
    ),
    queryClient,
  };
}

describe('DashboardSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDashboardData),
    });
  });

  it('renders loading state initially', () => {
    renderWithProviders(<DashboardSection />);
    expect(screen.getByRole('status', { name: /cargando dashboard/i })).toBeInTheDocument();
  });

  it('renders dashboard title', async () => {
    renderWithProviders(<DashboardSection />);
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });
  });

  it('displays user metrics correctly', async () => {
    renderWithProviders(<DashboardSection />);
    await waitFor(() => {
      expect(screen.getByTestId('card-users')).toBeInTheDocument();
      expect(screen.getByText('1250')).toBeInTheDocument();
      expect(screen.getByText('800 activos')).toBeInTheDocument();
      expect(screen.getByText('+45 este mes')).toBeInTheDocument();
    });
  });

  it('displays AI models status', async () => {
    renderWithProviders(<DashboardSection />);
    await waitFor(() => {
      expect(screen.getByTestId('card-ai-models')).toBeInTheDocument();
      expect(screen.getByText('8/12')).toBeInTheDocument();
      expect(screen.getByText('xAI')).toBeInTheDocument();
      expect(screen.getByText('Gemini')).toBeInTheDocument();
    });
  });

  it('displays payment information', async () => {
    renderWithProviders(<DashboardSection />);
    await waitFor(() => {
      expect(screen.getByTestId('card-payments')).toBeInTheDocument();
      expect(screen.getByText('€15,000.5')).toBeInTheDocument();
      expect(screen.getByText('156 transacciones')).toBeInTheDocument();
    });
  });

  it('displays database health status', async () => {
    renderWithProviders(<DashboardSection />);
    await waitFor(() => {
      expect(screen.getByTestId('card-database')).toBeInTheDocument();
      expect(screen.getByText('24 tablas')).toBeInTheDocument();
      expect(screen.getByText('Operativo')).toBeInTheDocument();
    });
  });

  it('displays system health panel', async () => {
    renderWithProviders(<DashboardSection />);
    await waitFor(() => {
      expect(screen.getByText('System Health')).toBeInTheDocument();
      expect(screen.getByText('99.95% uptime')).toBeInTheDocument();
    });
  });

  it('displays recent activity', async () => {
    renderWithProviders(<DashboardSection />);
    await waitFor(() => {
      expect(screen.getByText('Actividad reciente')).toBeInTheDocument();
      expect(screen.getByText('User signup')).toBeInTheDocument();
      expect(screen.getByText('Payment received')).toBeInTheDocument();
    });
  });

  it('has refresh button with accessible label', async () => {
    renderWithProviders(<DashboardSection />);
    await waitFor(() => {
      const refreshButton = screen.getByRole('button', { name: /actualizar dashboard/i });
      expect(refreshButton).toBeInTheDocument();
    });
  });

  it('calls refetch when refresh button is clicked', async () => {
    renderWithProviders(<DashboardSection />);

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    const refreshButton = screen.getByRole('button', { name: /actualizar dashboard/i });
    fireEvent.click(refreshButton);

    await waitFor(() => {
      // fetch should be called at least twice (initial + refresh)
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  it('has proper ARIA roles for metrics list', async () => {
    renderWithProviders(<DashboardSection />);
    await waitFor(() => {
      expect(screen.getByRole('list', { name: /métricas principales/i })).toBeInTheDocument();
    });
  });

  it('handles API error gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.reject(new Error('API Error')),
    });

    renderWithProviders(<DashboardSection />);

    // Should still render but with default/empty values
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });
  });
});
