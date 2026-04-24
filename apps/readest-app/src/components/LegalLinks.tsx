import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import Link from './Link';

const LegalLinks = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const isApplePlatform = appService?.isIOSApp || appService?.isMacOSApp;

  if (!isApplePlatform) return null;

  return (
    <div className='my-2 flex flex-wrap justify-center gap-4 text-sm sm:text-xs'>
      <Link
        href='https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'
        className='text-blue-500 underline hover:text-blue-600'
      >
        {_('Terms of Service')}
      </Link>
    </div>
  );
};

export default LegalLinks;
