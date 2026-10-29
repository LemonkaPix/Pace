import React from 'react';
import { Box, Text } from 'ink';
import { terminalLayout } from './layout.js';

/** Keep navigation reachable when a manager's content exceeds the viewport. */
export function PanelFrame({ width, height, children, footer, actions }: {
  width: number; height: number; children: React.ReactNode; footer: React.ReactNode; actions?: React.ReactNode;
}) {
  const layout = terminalLayout(width, height);
  return <Box flexDirection="column" width={width} height={Math.max(1, height)} paddingX={1} overflowY="hidden">
    <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} overflowY="hidden">{children}</Box>
    {actions ? <Box flexDirection="column" flexShrink={0} width={layout.contentWidth}>{actions}</Box> : null}
    <Box flexDirection="column" flexShrink={0} width={layout.contentWidth}><Text dimColor>{footer}</Text></Box>
  </Box>;
}
