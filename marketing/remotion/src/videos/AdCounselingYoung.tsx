import React from 'react';
import {AdCounseling, AdConfig} from './AdCounseling';

const youngConfig: AdConfig = {
  clips: {
    counselorFull: 'heygen/counselor-full.mp4',
    coupleMeet: 'heygen/couple-meet.png',
    coupleFalling: 'heygen/couple-falling.png',
    coupleDrift: 'heygen/couple-drift.png',
    couplePhone: 'heygen/couple-phone.png',
  },
  appFlow: {
    recipientName: 'Jake',
    occasion: 'Anniversary',
    message: 'Remember our first date? You had pizza sauce on your shirt.',
    songTitle: 'A Song for Jake',
  },
  endTagline: 'Remind each other.',
};

export const AdCounselingYoung: React.FC = () => (
  <AdCounseling config={youngConfig} />
);
