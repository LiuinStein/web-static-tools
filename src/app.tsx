import * as React from 'react';
import { runApp, IAppConfig } from 'ice';
import LocaleProvider from '@/components/LocaleProvider';
import { getLocale } from '@/utils/locale';
import { isOneDriveAuthCallback } from '@/services/onedrive-auth';

const locale = getLocale();

const appConfig: IAppConfig = {
  app: {
    rootId: 'ice-container',
    addProvider: ({ children }) => (
      <LocaleProvider locale={locale}>{children}</LocaleProvider>
    ),
  },
};
if (!isOneDriveAuthCallback(window.location, Boolean(window.opener) || window.parent !== window)) runApp(appConfig);
