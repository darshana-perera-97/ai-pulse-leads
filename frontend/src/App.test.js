import { render, screen } from '@testing-library/react';
import App from './App';

test('renders sign in screen', async () => {
  render(<App />);
  const heading = await screen.findByRole('heading', {
    name: /sign in/i,
  });
  expect(heading).toBeInTheDocument();
});
