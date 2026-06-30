import React from 'react';

const LOGO_SRC = '/ani_pharma_logo.png';

export default function AppLogo({ size = 130, width, height, className = '', alt = 'ANI Pharmaceuticals logo' }) {
  const finalWidth = width ?? size;
  const finalHeight = height ?? 'auto';
  return (
    <img
      src={LOGO_SRC}
      alt={alt}
      width={typeof finalWidth === 'number' ? finalWidth : undefined}
      height={typeof finalHeight === 'number' ? finalHeight : undefined}
      className={className}
      style={{ width: finalWidth, height: finalHeight, objectFit: 'contain' }}
      loading="eager"
      decoding="async"
    />
  );
}
