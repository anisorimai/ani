import React from 'react';
import AppLogo from '../AppLogo';

export default function AIHeader() {
  return (
    <header
      className="
        flex items-center
        px-4 sm:px-6 h-14 flex-shrink-0
        sticky top-0 z-50
        glass-header
        after:content-[''] after:absolute after:bottom-0
        after:left-0 after:right-0 after:h-px
        after:bg-gradient-to-r after:from-transparent after:via-[var(--brd2)] after:to-transparent
      "
    >
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="flex-shrink-0 sm:hidden logo-badge">
          <AppLogo size={150} />
        </div>
        <div className="flex-shrink-0 hidden sm:block logo-badge">
          <AppLogo size={210} />
        </div>
      </div>
    </header>
  );
}
