import React from 'react';
import { render } from '@testing-library/react';
import AuthProvider from '../AuthProvider';

// Mock next-auth react because the test doesn't have a real session provider context setup easily without it
jest.mock('next-auth/react', () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="session-provider">{children}</div>,
}));

describe('AuthProvider', () => {
  it('renders its children within the SessionProvider', () => {
    const { getByTestId, getByText } = render(
      <AuthProvider>
        <div>Test Child Component</div>
      </AuthProvider>
    );

    expect(getByTestId('session-provider')).toBeInTheDocument();
    expect(getByText('Test Child Component')).toBeInTheDocument();
  });
});
