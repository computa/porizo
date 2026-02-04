# TestFlight Test Scenarios

Comprehensive test scenarios for validating the Porizo iOS app before TestFlight submission.

---

## Scenario 1: New User Happy Path

**Goal:** Verify complete new user journey from signup to song preview.

### Steps
1. Download TestFlight build
2. Launch app, tap "Get Started"
3. Sign up with Apple Sign-In
4. Complete voice enrollment:
   - Record all 8 phrases
   - Wait for processing to complete
5. Create a birthday song:
   - Tap "Create Song"
   - Select "Birthday" occasion
   - Enter recipient name: "Sarah"
   - Add a personal message
   - Select a music style
   - Tap "Create Preview"
6. Wait for preview to render (~90 seconds)
7. Play the preview song
8. Test background playback:
   - Lock the device
   - Verify Now Playing shows on lock screen
9. Log out from Settings
10. Log back in with same Apple ID

### Expected Results
- [ ] Enrollment session completes with status = `completed`
- [ ] Voice profile shows quality_score ≥ 70
- [ ] Preview renders successfully in < 90 seconds
- [ ] Lock screen shows Now Playing metadata
- [ ] Session persists after logout/login

---

## Scenario 2: Voice Enrollment Quality Control

**Goal:** Verify QC system correctly detects and rejects poor quality recordings.

### Steps
1. Start voice enrollment
2. For first phrase, record with:
   - Background noise (TV, music, traffic)
   - Speaking very quietly
3. Observe QC feedback
4. Re-record the phrase in quiet environment
5. Complete all remaining phrases cleanly
6. Verify enrollment completes

### Expected Results
- [ ] Low SNR recording triggers re-record prompt
- [ ] Clipping detection warns about distortion
- [ ] Final quality_score reflects recording quality
- [ ] Enrollment completes with adequate score

---

## Scenario 3: Audio Interruption Handling

**Goal:** Verify app correctly handles audio session interruptions.

### Steps
1. Start playing a preview song
2. While playing, trigger phone call (use second phone or Facetime)
3. Answer and end the call
4. Check if audio resumes
5. Start playing again
6. Trigger Siri ("Hey Siri, what time is it?")
7. After Siri responds, check audio state
8. Connect Bluetooth headphones mid-playback
9. Disconnect Bluetooth mid-playback

### Expected Results
- [ ] Phone call pauses playback
- [ ] Audio resumes after call ends (or offers to resume)
- [ ] Siri pauses audio temporarily
- [ ] Audio resumes after Siri
- [ ] Bluetooth connect routes audio correctly
- [ ] Bluetooth disconnect falls back to speaker

---

## Scenario 4: Network Resilience

**Goal:** Verify app handles network failures gracefully during song creation.

### Steps
1. Start creating a new song
2. Fill in all details (recipient, message, style)
3. Tap "Create Preview"
4. Wait for render to start (see progress indicator)
5. Enable Airplane Mode
6. Observe error handling
7. Disable Airplane Mode
8. Check if render resumes or offers retry

### Expected Results
- [ ] Network unavailable shows clear error message
- [ ] No crash or data loss
- [ ] Re-enabling network allows retry
- [ ] Song creation data preserved

---

## Scenario 5: Background Persistence (Force Quit)

**Goal:** Verify in-progress data survives app force quit.

### Steps
1. Start creating a new song
2. Fill in recipient name and message
3. Do NOT tap create yet
4. Force-quit the app (swipe up in app switcher)
5. Relaunch the app
6. Check if creation flow offers to resume

### Expected Results
- [ ] App offers to resume in-progress creation
- [ ] Entered data (name, message) is preserved
- [ ] User can continue or start fresh

---

## Scenario 6: Accessibility (VoiceOver)

**Goal:** Verify app is accessible with VoiceOver enabled.

### Steps
1. Enable VoiceOver (Settings → Accessibility → VoiceOver)
2. Launch Porizo app
3. Navigate through:
   - Onboarding screens
   - Sign-in flow
   - Main tabs (Songs, Explore, Settings)
   - Song creation flow
4. Verify all buttons announce their purpose
5. Verify text fields announce their labels
6. Verify progress indicators are announced

### Expected Results
- [ ] All interactive elements have accessibility labels
- [ ] Navigation order is logical (left-to-right, top-to-bottom)
- [ ] Dynamic content updates are announced
- [ ] No "button" or "image" without descriptive label

---

## Scenario 7: OAuth Sign-In Flows

**Goal:** Verify all authentication methods work correctly.

### Steps

#### Apple Sign-In
1. Fresh install of app
2. Tap "Continue with Apple"
3. Authenticate with Face ID / Touch ID
4. Choose to share or hide email
5. Verify account created successfully

#### Google Sign-In
1. Log out of current account
2. Tap "Continue with Google"
3. Select Google account
4. Verify redirect back to app
5. Verify account created successfully

#### Phone Sign-In
1. Log out of current account
2. Tap "Continue with Phone"
3. Enter valid phone number
4. Enter SMS verification code
5. Verify account created successfully

### Expected Results
- [ ] All three sign-in methods complete successfully
- [ ] OAuth redirects return to app correctly
- [ ] Account info displays correctly in Settings

---

## Scenario 8: Subscription Flow (Sandbox)

**Goal:** Verify in-app purchase flow works in sandbox environment.

### Prerequisites
- Sandbox Apple ID created in App Store Connect
- Signed out of production Apple ID on device

### Steps
1. Sign in to Porizo with test account
2. Navigate to subscription screen
3. Tap "Upgrade to Plus"
4. Authenticate with sandbox Apple ID
5. Complete purchase
6. Verify subscription status updates
7. Wait for sandbox renewal (3-5 minutes for monthly)
8. Verify renewal is processed

### Expected Results
- [ ] StoreKit sheet shows subscription options
- [ ] Purchase completes without error
- [ ] Subscription status shows "Plus" tier
- [ ] Renewal processes in sandbox timeframe

---

## Scenario 9: Push Notification Registration

**Goal:** Verify push notifications are set up correctly.

### Prerequisites
- TestFlight build (not debug build)
- APNs key uploaded to Firebase

### Steps
1. Fresh install from TestFlight
2. Launch app
3. Approve notification permission when prompted
4. Check Firebase Console for device registration
5. Create a song and wait for render
6. Verify completion notification received

### Expected Results
- [ ] Permission prompt appears
- [ ] APNs token registers successfully
- [ ] Device appears in Firebase Cloud Messaging
- [ ] Render completion notification received

---

## Scenario 10: Edge Cases

**Goal:** Verify app handles edge cases gracefully.

### Steps

#### Empty State
1. New account with no songs
2. Navigate to My Songs tab
3. Verify empty state shows helpful message

#### Long Text Input
1. Create song with very long recipient name (50+ characters)
2. Create song with very long personal message (500+ characters)
3. Verify text doesn't overflow UI

#### Rapid Actions
1. Tap Create Preview multiple times rapidly
2. Verify only one render job is created

#### Low Storage
1. Fill device storage to near capacity
2. Attempt to create song
3. Verify helpful error message

### Expected Results
- [ ] Empty states show helpful onboarding
- [ ] Long text truncates with ellipsis where needed
- [ ] Duplicate prevention works
- [ ] Low storage shows appropriate error

---

## Pre-Submission Checklist

After completing all scenarios:

- [ ] All core flows complete without crashes
- [ ] No placeholder text visible in UI
- [ ] All buttons are tappable (44pt minimum)
- [ ] App works in both light and dark mode
- [ ] Performance acceptable on oldest supported device (iPhone 11)
- [ ] No sensitive data logged to console
- [ ] Crashlytics receiving crash reports

---

## Reporting Template

Use this template when reporting issues:

```
**Scenario:** [Number and name]
**Step:** [Which step failed]
**Expected:** [What should happen]
**Actual:** [What actually happened]
**Device:** [Model, iOS version]
**Build:** [TestFlight build number]
**Screenshots:** [Attach if helpful]
```
