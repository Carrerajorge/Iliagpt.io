import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AvatarWithFallback } from '../AvatarWithFallback';

describe('AvatarWithFallback', () => {
  it('renders image when src is valid', () => {
    render(
      <AvatarWithFallback
        src="https://example.com/avatar.png"
        alt="User avatar"
        fallback={<span>FB</span>}
      />
    );

    const img = screen.getByAltText('User avatar');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/avatar.png');
  });

  it('renders fallback when image fails to load', () => {
    render(
      <AvatarWithFallback
        src="https://example.com/broken.png"
        alt="User avatar"
        fallback={<span data-testid="fallback">FB</span>}
      />
    );

    const img = screen.getByAltText('User avatar');
    fireEvent.error(img);

    expect(screen.getByTestId('fallback')).toBeInTheDocument();
    expect(screen.queryByAltText('User avatar')).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <AvatarWithFallback
        src="https://example.com/avatar.png"
        alt="User avatar"
        fallback={<span>FB</span>}
        className="w-10 h-10 rounded-full"
      />
    );

    const wrapper = container.firstChild;
    expect(wrapper).toHaveClass('w-10', 'h-10', 'rounded-full');
  });

  it('has accessible role and label for fallback', () => {
    render(
      <AvatarWithFallback
        src="https://example.com/broken.png"
        alt="User avatar"
        fallback={<span>FB</span>}
      />
    );

    const img = screen.getByAltText('User avatar');
    fireEvent.error(img);

    const fallbackContainer = screen.getByRole('img', { name: 'User avatar' });
    expect(fallbackContainer).toBeInTheDocument();
  });
});
