/**
 * The URL-synced status filter primitive: toggle semantics (click = filter,
 * click again = clear), replace-not-push history, and the badge/notice UI
 * states. Pages test their own row filtering; this file owns the primitive.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { useStatusFilter, StatusFilterBadge, ActiveFilterNotice } from '@/components/StatusFilter';

const replace = jest.fn();
let search = '';
jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace }),
    usePathname: () => '/membership-ops/applications',
    useSearchParams: () => new URLSearchParams(search),
}));

function Probe() {
    const { active, toggle, clear } = useStatusFilter();
    return (
        <div>
            <StatusFilterBadge value="PENDING_PAYMENT" active={active} onToggle={toggle} color="orange">
                PENDING PAYMENT: 2
            </StatusFilterBadge>
            <ActiveFilterNotice active={active} label={(s) => s.replace(/_/g, ' ')} onClear={clear} />
        </div>
    );
}

const renderProbe = () => render(<MantineProvider><Probe /></MantineProvider>);

beforeEach(() => {
    replace.mockClear();
    search = '';
});

it('clicking an inactive badge sets the status param (replace, no scroll)', () => {
    renderProbe();
    fireEvent.click(screen.getByRole('button', { name: /PENDING PAYMENT/ }));
    expect(replace).toHaveBeenCalledWith(
        '/membership-ops/applications?status=PENDING_PAYMENT',
        { scroll: false },
    );
});

it('clicking the active badge clears the param; badge shows pressed state', () => {
    search = 'status=PENDING_PAYMENT';
    renderProbe();
    const badge = screen.getByRole('button', { name: /PENDING PAYMENT/ });
    expect(badge).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(badge);
    expect(replace).toHaveBeenCalledWith('/membership-ops/applications', { scroll: false });
});

it('notice renders only while filtering and its clear button clears', () => {
    renderProbe();
    expect(screen.queryByText(/Showing only/)).toBeNull();

    search = 'status=PENDING_PAYMENT';
    renderProbe();
    expect(screen.getByText(/Showing only/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(replace).toHaveBeenCalledWith('/membership-ops/applications', { scroll: false });
});

it('other query params survive a toggle', () => {
    search = 'q=smith';
    renderProbe();
    fireEvent.click(screen.getByRole('button', { name: /PENDING PAYMENT/ }));
    expect(replace).toHaveBeenCalledWith(
        '/membership-ops/applications?q=smith&status=PENDING_PAYMENT',
        { scroll: false },
    );
});
