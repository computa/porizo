import React from 'react';
import {AdCounseling, AdConfig} from './AdCounseling';

const establishedConfig: AdConfig = {
  clips: {
    counselorFull: 'heygen/counselor-full.mp4',
    coupleMeet: 'heygen/est-meet.png',
    coupleFalling: 'heygen/est-falling.png',
    coupleDrift: 'heygen/est-drift.png',
    couplePhone: 'heygen/est-phone.png',
  },
  appFlow: {
    recipientName: 'Sarah',
    occasion: 'Anniversary',
    message: 'Remember our first dance? You stepped on my feet and we couldn\'t stop laughing.',
    songTitle: 'A Song for Sarah',
  },
  endTagline: 'Remind each other.',
};

export const AdCounselingEstablished: React.FC = () => (
  <AdCounseling config={establishedConfig} />
);
