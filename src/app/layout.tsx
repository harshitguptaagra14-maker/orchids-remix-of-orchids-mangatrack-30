import './globals.css';
import { ReactNode } from 'react';
import Script from 'next/script';
import { ThemeProvider } from '@/components/theme-provider';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <Script
            id="orchids-browser-logs"
            src="https://slelguoygbfzlpylpxfs.supabase.co/storage/v1/object/public/scripts/orchids-browser-logs.js"
            strategy="afterInteractive"
            data-orchids-project-id="0b6f8918-525c-4bf6-97b9-25683f3a2bb1"
          />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}