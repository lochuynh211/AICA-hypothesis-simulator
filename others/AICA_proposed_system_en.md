# AICA / AIP Music Planning Deck — English Translation and Planner Reading

Source deck: `CDC-SU_音楽企画_システム要求仕様書.pptx`  
Original Japanese title: **CDC-SU 音楽企画 システム要求仕様書**  
Working English title: **CDC-SU Music Planning — System Requirements Specification**

> Note: This document is a readable English translation and planning interpretation of the PowerPoint. It is not a pixel-perfect reproduction of slide layout. The separate Japanese Markdown extraction preserves the slide-by-slide text/table extraction.

---

## 1. Executive reading

The deck describes an **AIP in-car proposal function** centered on music, entertainment, and recovery content. It is broader than only drowsiness/rest. It defines a proposal system that monitors driver/vehicle/route/context data, computes feature scores, decides whether a trigger should fire, controls proposal density, selects candidate content, and provides content before/during/after driving or rest.

For the AICA simulator, the most relevant part is **Proposal Category ①: dangerous-driving prevention**, where AIP detects that the driver is tired or sleepy, recommends an immediate rest, navigates to a rest location, proposes content to keep the driver awake until stopping, and then proposes recovery content after parking or after a nap.

The deck also defines adjacent but related proposal categories:

1. **Dangerous-driving prevention proposal**  
   Rest recommendation + content before reaching the rest area + content after rest.
2. **Monotony / fatigue recovery proposal**  
   Prevent inattentive driving on monotonous roads, familiar routes, congestion, night driving, highway driving, etc.
3. **Route-based music proposal**  
   Use scenic, unusual, emotional, or “oshi”-related route context to propose music.
4. **Child-passenger proposal**  
   Detect child passengers and propose child-oriented content to improve the cabin experience and help the driver concentrate.

The deck’s core requirements direction is:

> AIP should detect current or future fatigue risk, choose an appropriate proposal objective, avoid excessive proposals, personalize content using user preferences and past acceptance/recovery results, and provide safe, low-burden content depending on whether the vehicle is moving or parked.

---

## 2. Glossary / important terms

| Japanese / deck term | Working English meaning |
|---|---|
| AIP | In-car AI proposal/assistant platform. The deck uses AIP as the system that judges triggers, proposes content, speaks to the user, and coordinates apps/services. |
| 音楽企画 | “Music planning” or “music proposal initiative.” In the deck this includes music, karaoke, quiz, radio-style content, videos, lighting, and fan/oshi experiences. |
| 推し | “Oshi”; a favorite idol, artist, character, team, celebrity, or fandom target. |
| 推し活 | Fan activity around the user’s oshi. |
| 漫然運転 | Inattentive / mindless / monotonous driving. Not necessarily severe drowsiness, but reduced engagement or attention. |
| 休憩提案 | Rest recommendation / rest proposal. |
| 疲労回復コンテンツ | Fatigue recovery content. |
| 休憩前コンテンツ | Pre-rest content, used while driving to the rest location. |
| 休憩後コンテンツ | Post-rest content, used after stopping or after a nap to wake the driver gently. |
| 鼻歌カラオケ | Hum-along karaoke; casual chorus-only karaoke without screen lyrics while driving. |
| 合いの手 | Call-and-response / cheering interjections used in idol/live music culture. |
| MM | Multimedia display or in-car infotainment screen. |
| RSE | Rear-seat entertainment. |
| IG-ON / IG-OFF | Ignition on/off. |
| CANデータ | Vehicle CAN data, such as steering, acceleration, brake, lane departure, low-speed continuation, etc. |
| VICS | Japanese road traffic information system; used here for congestion and traffic prediction. |
| ミリ波 | Millimeter-wave sensor, used for passenger/child detection. |
| UPro / UserProfile | User profile information such as age, gender, preferences, app settings, oshi registration. |
| 発火 | Trigger firing; the system decides to present a proposal. |
| 発火制御 | Trigger fire-control; suppresses excessive proposals by managing interval, count, and recent response. |

---

## 3. Slide-group translation and interpretation

### Slides 1–7 — Physical fatigue / drowsiness rest proposal

The first use case focuses on detecting physical fatigue or drowsiness and guiding the driver to a rest place.

#### Persona A

A woman in her early 20s is driving home with a friend. She is sleep-deprived and tired, but she does not notice her own condition.

#### Main scenario

1. The user previously registered oshi information in an app.
2. The user and friend get into the car to return home and start driving.
3. AIP determines from driving time and user state that rest is necessary.
4. To motivate voluntary rest, AIP uses oshi information and past acceptance rates to propose:  
   - rest guidance, and  
   - candidate recovery content after rest.
5. The driver accepts the rest proposal and receives navigation to the rest place.
6. During the drive to the rest place, AIP proposes content to suppress drowsiness.
7. The user selects hum-along karaoke and enjoys it until the rest area.
8. After arrival and parking, AIP proposes rest duration and rest method.
9. The user selects or specifies the rest time/method.
10. Because seat adjustment affects driving, AIP asks for confirmation before adjusting the seat.
11. The user naps until the specified time.
12. At the end of the rest period, AIP asks whether the user wants to continue resting.
13. When the user ends rest, AIP proposes recovery content to gently wake the body and prevent mindless driving after restart.

#### Post-rest content branches

The deck describes several post-rest content options:

- **Karaoke**: AIP launches the karaoke app, reserves accepted songs, allows flexible song addition from smartphone or MM, and may generate lighting patterns synchronized to music. Concern: presentation/lighting may be excessive for a just-woken user.
- **Limited live video**: plays exciting live footage to wake the user and refresh mood. Concern: video search time and excessive stimulation after waking.
- **Oshi spot re-experience**: proposes a local oshi-related spot that can only be experienced at that location; sends details to smartphone so the user can enjoy it smoothly while preserving rest time. Concern: avoid guiding to unsafe places.
- **Stretch video**: proposes a short, easy recovery activity. Concern: accurately obtaining a stretch video that can be performed inside the car.

#### Persona B

A man in his early 30s is driving home after work. His head feels foggy. He believes “rest equals lost time.”

This variant frames the rest proposal as a short, convenient fatigue-recovery suggestion. The user accepts navigation to a nearby rest place, such as a convenience store, and then selects stretch content after stopping.

#### Planning reading

This is the strongest fit for AICA. It already contains the major simulator loop:

- detect fatigue/drowsiness;
- decide whether rest is needed now;
- propose rest in a way the user is likely to accept;
- keep the user awake until the rest place;
- support rest quality;
- support safe restart after rest.

For simulation, the key unknown is not the content list itself. The key unknown is **the timing and justification of the trigger**: when should the rest proposal fire, and when should the system suppress or delay it?

---

### Slides 8–9 — Child-passenger cabin experience proposal

The child-passenger use case is separate from drowsiness/rest but uses the same AIP proposal mechanism.

#### Persona

A man in his early 30s has RSE installed. On daycare drop-off days he is usually rushed. A fussy child in the rear seat makes it hard for him to focus on driving.

#### Scenario variants

1. **Resume home video**  
   The child was watching a video at home before departure. When the driver gets into the vehicle and IG-ON is detected, AIP detects the child passenger and proposes resuming the previously watched video.

2. **Child video recommendation**  
   AIP detects child passenger presence and uses past acceptance rates or viewing history to recommend child-appropriate video content on RSE.

#### Concerns

- The driver must understand what content is being proposed.
- The system should avoid biased/repetitive proposals.
- Selecting among multiple content options under time pressure may be burdensome.
- The system must avoid playing inappropriate videos for children.
- The driver should be able to confirm what is being played on RSE.

#### Planning reading

This category is useful for the AICA simulator mainly as a **conflict or context factor**. For example, if the driver is sleepy and a child is present, the system must balance rest safety, child content, driver cognitive load, and safety constraints.

---

### Slides 10–17 — Monotony, familiar-route, and attention-decline recovery proposals

These slides describe cases where immediate rest may not be required, but AIP detects a risk of mindless/inattentive driving.

#### Persona

A woman in her late 50s supports a domestic idol group with her daughter and is looking forward to a live event one month later. She is returning home after shopping on a familiar road.

Another variant describes a woman driving on a familiar route while thinking about household tasks after returning home; her attention is drifting.

#### Main scenario

1. The user pre-registers oshi information.
2. She gets into the car after shopping and sets the route home.
3. AIP detects that this is a familiar, routine route.
4. Because the road is boring, AIP proposes playlist playback as mindless-driving prevention content.
5. With a simple Yes/No interaction, a scene-appropriate playlist is automatically played.
6. If congestion or future fatigue factors are detected, AIP proposes recovery content chosen from past acceptance rates and other context.

#### Content options

- **Playlist creation**: creates an alertness-oriented playlist during congestion; explains why the playlist fits the trigger and user preference; asks continuation after a defined number of songs.
- **Hum-along karaoke**: screenless, chorus-only, casual karaoke; uses oshi info and karaoke rankings; confirms playlist content before starting; may use lighting.
- **Quiz**: safe voice-only quiz during spare time; suppresses drowsiness through intellectual load; may include oshi quiz, general quiz, or child quiz; may send result reports to smartphone later.
- **Radio-style delivery**: short entertainment/news summary; may send source/content and shopping list to smartphone; concerns include misinformation and unreliable sources.
- **Call-and-response practice**: plays call-and-response audio based on oshi info or set lists; may use lighting.
- **Ranking creation**: creates an original playlist/ranking through simple two-choice dialogue, e.g., “oshi songs for summer”; later enables playlist playback, editing, and sharing.
- **AI conversation**: if attention decline is detected, AIP may conduct natural conversation about scenery or experienced context to bring the user’s awareness back into the car.

#### Planning reading

This category is relevant to AICA because it defines the middle zone between “safe” and “must stop now.” For simulator design, we should model at least three bands:

1. **Normal / low risk**: no intervention.
2. **Monotony or fatigue warning**: light in-car recovery content may be proposed.
3. **Danger / rest required**: rest guidance becomes the main proposal.

AICA should not treat all drowsiness as the same. Mild fatigue can lead to light recovery content, but severe or rapidly increasing drowsiness should override entertainment and trigger rest guidance.

---

### Slide 18 — Functional placement / architecture concept

The architecture diagram positions the music proposal function across in-car and out-car systems.

#### Main components mentioned

- **TSCMM / Agent / MM**: in-car interface and agent-related layer.
- **AIP (music planning)**: central proposal function.
- **LLM**: speech/content generation and proposal content decision support.
- **VDP**: vehicle information linkage.
- **Navi**: route guidance.
- **Media / phone**: media playback and phone-related integration.
- **MyT/L AIP app**: app linkage.
- **SPUI / UserProfile**: user interface and profile integration.
- **TSCGC / remote services / out-car server**: app linkage, remote services, external information, content generation/aggregation.
- **Oshi activity app**: oshi registration and fan information linkage.
- **Home appliance server**: home-video viewing history and home integration.

#### Major responsibilities

- Analyze information and proposal triggers.
- Collect vehicle, route, user, and external data.
- Decide proposal content.
- Generate proposal details, speech, and display content.
- Start music/video/karaoke apps.
- Generate playlists, quizzes, news summaries, lighting patterns, and video choices.
- Link playback or result reports to smartphone apps.

#### Planning reading

For AICA simulator V1, this architecture can be simplified into logical services:

1. **Sensor/state provider**: provides trip, route, driver state, traffic, passenger, and profile values.
2. **Trigger engine**: computes risk and proposal category.
3. **Fire-control engine**: throttles proposals and handles override conditions.
4. **Content/recommendation engine**: chooses rest plan and content.
5. **Dialogue/HMI engine**: generates the spoken/displayed proposal.
6. **Evidence logger**: records why the system fired and what the human judged.

---

### Slides 19–25 — Flowchart and sequence for mindless-driving prevention proposal

The example flow is: when the user sets a route, AIP detects future fatigue factors, proposes mindless-driving prevention content, and the user selects playlist playback.

#### Flow summary

1. User gets in the car and IG-ON is detected.
2. In-car and vehicle information are linked.
3. In-car information is obtained.
4. Trigger-firing judgment is performed.
5. If no trigger fires, the system continues ordinary display/speech and monitoring.
6. When the route is set, route information is linked and obtained.
7. Trigger judgment is executed again using route data.
8. If the trigger fires, proposal-content judgment data is obtained.
9. AIP selects and links the proposed content.
10. Mindless-driving prevention content is displayed/spoken.
11. The user selects playlist playback by voice.
12. The voice input is linked and analyzed.
13. A playlist is created.
14. Created playlist and speech content are linked.
15. AIP explains the playlist theme and starts playback.

#### Sequence interpretation

The sequence diagrams show interaction among User, AIP, LLM(AIP), VDP, TSC Agent/TSCGC, and a home/external server. They emphasize repeated cycles of:

- information collection;
- vehicle/route information linkage;
- trigger judgment;
- proposal content judgment;
- user utterance analysis;
- content generation;
- playback/speech delivery.

#### Planning reading

For AICA, this maps well to a simulator event trace. Every run should show:

- what raw monitoring data existed;
- which feature scores were calculated;
- which thresholds were crossed;
- whether fire-control suppressed the proposal;
- which proposal was selected;
- what the user response was;
- what state changed after content/rest.

---

### Slides 26–36 — AIP trigger detection, firing, data definition, and tuning

This is the most important technical section for AICA.

#### Overall AIP proposal function

The AIP proposal function has these stages:

1. Monitoring.
2. Trigger detection and firing according to purpose.
3. Proposal service selection.
4. Speech/content playback.
5. End-of-content judgment.
6. Return to previous content, end, play another content, or user cancellation.
7. Use tuning information such as weights and proposal density.

#### Monitoring data and features

The deck distinguishes between:

- **Monitoring data / raw data**: CAN data, camera, millimeter-wave sensor, MM, road/route information, VICS, user profile, oshi app settings, past route history, etc.
- **Features**: processed variables used for trigger detection.
- **Fire-control data**: proposal frequency, proposal count, recent proposal acceptance/rejection.
- **Tuning data**: personal characteristics and past proposal results used to adjust thresholds and weights.

#### Major feature groups

1. **Safety-driving continuity**  
   Used for Proposal ① and ②. It includes:
   - driving record: trip distance/time/count;
   - current driver state: drowsiness and fatigue;
   - future fatigue factors: congestion prediction, long highway driving;
   - recovery possibility/rest opportunity;
   - continued lack of stimulation: monotonous road, tunnel, night driving, familiar road.

2. **Route emotional level**  
   Used for Proposal ③. It includes:
   - scenic routes such as sea, mountain, forest, urban/night-view areas;
   - non-daily or unusual route/destination context;
   - oshi-related places or pilgrimage spots;
   - whether the route is frequently driven or unusual.

3. **Child passenger presence/status**  
   Used for Proposal ④. It includes:
   - child present/not present;
   - child awake, sleepy, or sleeping;
   - millimeter-wave and app/user-registration information.

#### Drowsiness/fatigue detection examples

The deck suggests using:

- camera/driving-recorder posture estimation abnormalities;
- CAN abnormalities such as steering, accelerator/brake operation, or ADAS/lane-departure events;
- trip time/distance/count;
- abnormal response speed or prosody in responses to AIP speech.

#### Future fatigue-factor detection examples

The deck suggests using:

- congestion scale from VICS and route information;
- distance/time until entering or leaving congestion;
- low-speed continuation time from CAN data where VICS cannot detect the congestion;
- highway-section distance and distance/time until entering/leaving highway sections;
- rest-opportunity density or interval along the route.

#### Monotonous-road detection examples

The deck suggests detecting:

- long single roads with low signal density;
- long tunnels;
- night driving based on sunset/darkness;
- familiar routes from route history and number of past trips.

#### Tuning analysis data

The deck proposes adapting weights and thresholds using:

- individual long-distance driving tolerance;
- external factors that accumulate fatigue/drowsiness for that person;
- acceptance rate and playback continuation rate;
- user response by proposal context: used, dropped, ignored, rejected;
- recovery rate after each proposal context;
- examples such as “user gets sleepy in congestion,” “user tires during long highway driving,” or “highway-driving + drowsiness proposals have high acceptance and recovery.”

#### Fire control / proposal suppression

The deck explicitly avoids excessive proposals by using:

- proposal interval after the most recent proposal;
- adjusting interval based on latest result: used, dropped, ignored, rejected;
- maximum number of proposals per unit time;
- adjusting the maximum count based on recent results.

However, fire control can be bypassed when safety need is high:

- threshold is exceeded by a large margin;
- feature score is increasing rapidly;
- proposal necessity is high.

#### Proposal classification

| Proposal category | Purpose | User state at firing |
|---|---|---|
| ① Dangerous-driving prevention proposal | Rest proposal, wakefulness until rest location, refresh at rest location | Safe driving continuity is concerning; immediate rest is needed. |
| ② Monotony / fatigue recovery proposal | Recover fatigue and prevent mindless driving on tunnel/highway/congestion/night/commute roads | Immediate rest is not required, but safe driving continuity has some concern or mindless driving risk exists. |
| ③ Route-based music proposal | Improve in-car experience using route context | Route allows meaningful music proposal. |
| ④ Child-passenger proposal | Improve child passenger experience and driver concentration | Child is present. |

#### Future work in the deck

The deck says the team has initial parameters and high-level logic hypotheses, but still needs:

- parameter review;
- logic-policy hypothesis review;
- simulator verification;
- parameter revision and detailed logic design;
- simulator validation methodology;
- system requirement refinement.

It also lists possible approaches:

- rule-based logic;
- machine learning;
- scoring;
- optimization model.

#### Planning reading

This is exactly where AICA fits. The deck itself says simulator verification is a future activity. Therefore, AICA should be positioned as the tool that turns this abstract trigger/feature/threshold design into testable scenarios and evidence.

---

### Slides 37–40 — Proposal content overview and UX

The deck divides content by vehicle state and start method.

#### Driving content

Used while the vehicle is moving, especially when there is risk of mindless driving or when the driver needs support until reaching a rest location. It should be mostly voice-only and safe for driving. MM screen usage may be allowed only within legal/safety constraints.

Examples:

- music recommendation;
- hum-along karaoke;
- call-and-response practice;
- quiz;
- ranking creation;
- radio-style playback.

#### Parked content

Used when immediate rest is recommended or when the vehicle is stopped. Mainly video-centric, using screens after parking or after a nap.

Examples:

- live viewing;
- stretch video;
- full karaoke;
- call-and-response practice;
- oshi spot experience.

#### AI proposal start vs user-request start

- If AI proposes and the user accepts, content starts according to the vehicle state and safety constraints.
- If the user requests content, the system may start immediately if safe, or run background playback while prompting movement to a rest location if visual content is not appropriate while driving.

---

### Slides 41–62 — Major use cases for individual content

The deck expands each content type into a main user flow. The detailed flows are repetitive, but the important patterns are below.

#### Playlist playback

- AI proposes playlist content while driving.
- The user accepts.
- AIP creates a playlist based on trigger and preference.
- AIP explains the playlist briefly and starts playback.
- The user may request termination.

#### Hum-along karaoke

- AI proposes chorus-only karaoke suitable for driving.
- User accepts or chooses a song.
- AIP creates a playlist and may use guide vocals.
- Lyrics display is avoided while driving.
- User can end it or continue.

#### Call-and-response practice

- AI proposes call-and-response practice.
- AIP chooses audio and lighting patterns based on oshi/set-list context.
- If rest is required, the system may route the user to a rest place and provide content appropriately.

#### Quiz

- AI proposes quiz content.
- User selects genre.
- AIP reads questions aloud, gives feedback one by one, announces the score, and may send results to the app.
- It should avoid excessive cognitive or interaction load.

#### Ranking creation

- AI proposes a theme such as an oshi song ranking.
- User answers two-choice questions.
- AIP creates a ranking/playlist and can link it to the app.
- The playlist may be played afterward.

#### Radio-style playback

- AIP summarizes latest oshi/entertainment information in a few minutes.
- It should provide source information and may send shopping information to the app.
- It should not repeat if there is no fresh information since the previous use.

#### Live viewing

- AIP proposes live video, especially parked/post-rest.
- If started while driving by user request, video is background playback and visible video is delayed until parked.
- Lighting may enhance immersion.

#### Stretch video

- AIP proposes a short stretch video after stopping.
- If the vehicle is moving, it should not show video in a way that distracts the driver.
- It can be useful as post-rest or quick fatigue recovery.

#### Full karaoke

- Mainly parked/post-rest.
- AIP proposes a song; if rejected, the user can search or choose from recommendations/rankings.
- Songs can be queued from MM or smartphone.
- If the vehicle starts moving, lyrics/video should be suppressed and playback moves to background mode.

#### Oshi spot re-experience

- AIP searches for nearby oshi-related spots.
- If a spot exists, it can set it as destination and start navigation.
- During the drive to the spot, it may propose content.
- At the spot, the user can rest/nap, then AIP gives oshi episode or spot-enjoyment guidance.
- Safety of the proposed place is a key concern.

#### Child-passenger content reference

- For initial implementation, the deck assumes the child is awake.
- If no child is present, child content is not proposed.
- If a child is present and awake, video recommendation may be proposed if RSE exists.
- If the child is sleepy or sleeping, the approach may differ in future.

---

### Slides 63–82 — Content provision, end conditions, prioritization, and input data

This section defines how content is selected, started, ended, continued, or replaced.

#### General flow for Proposal ①

1. Trigger fires.
2. The system determines display order for content candidates.
3. The candidate order is based on user situation × user preference.
4. Multiple candidates are presented.
5. The user chooses content.
6. AIP decides concrete content details, such as quiz genre or playlist mode.
7. Content is provided.
8. End trigger occurs.
9. After the end trigger, the system decides whether to:
   - continue;
   - propose another content;
   - return to previous content;
   - end;
   - re-check threshold after a period.

For Proposal ①, the system also has rest-specific navigation/rest behavior.

#### General flow for Proposals ②–④

The flow is similar, but the purpose differs:

- Proposal ②: monotony/fatigue recovery.
- Proposal ③: route-based music.
- Proposal ④: child-passenger experience.

These proposals emphasize content presentation and continuation more than mandatory rest guidance.

#### Content candidate display-order process

Inputs:

- feature situation;
- content candidates for the situation;
- whether the content matches user preferences;
- past proposal results;
- user acceptance/continuation/rejection history.

Output:

- content display priority;
- actual displayed order of multiple proposals.

#### Priority judgment materials

| Feature / factor | Expected effect | Priority examples |
|---|---|---|
| High drowsiness/fatigue | Mindless-driving risk increases; use physical activity or intellectual load to suppress sleepiness | Hum-along karaoke, call-and-response, quiz, ranking |
| Congestion, highway, night, monotonous road | Maintain alertness and reduce boredom | Music, karaoke, quiz, radio, etc. |
| Scenic / distinctive route or destination | Use content tied to environment | Route-linked music, oshi spot content |
| Child or multiple passengers | Use content that works for passengers | Live viewing, karaoke, child content, quiz |
| Oshi information / oshi mode | Emotional uplift and concentration through fan interest | Oshi-mode content, live, karaoke, oshi spots |
| Unused or not recently used function | Stimulation through novelty | Prioritize unused/long-unseen functions |

#### Concrete content selection materials

When choosing the actual content, the system adds more inputs:

- current driver state;
- road/route environment;
- route/destination features;
- passenger composition;
- moving/stopped state;
- user profile;
- oshi information;
- unused function status;
- usage frequency;
- scene-specific preference;
- operation history;
- schedule;
- proposal acceptance rate;
- recovery rate.

#### Content-specific input examples

The deck lists similar input matrices for:

- playlist playback;
- hum-along karaoke;
- call-and-response practice;
- quiz;
- ranking;
- radio-style playback;
- live viewing;
- stretch video;
- karaoke;
- oshi spot experience.

Most content types use driver fatigue, road environment, destination, user profile, usage frequency, and schedule. Some content types additionally use:

- song/artist playback history;
- skip/change logs;
- video publisher/video playback history;
- previous ranking results;
- fresh information since previous radio playback;
- child passenger state;
- oshi registration and oshi mode.

#### End conditions and behavior

For AI-proposed content, typical end conditions include:

- a fixed number of songs completed;
- one quiz/ranking/radio set completed;
- one stretch video completed;
- one karaoke song completed;
- manual user stop.

After ending, the system may:

- ask whether to continue;
- propose another content;
- return to the pre-trigger state;
- re-check the threshold after a period;
- continue background playback if driving starts;
- turn off visual/lyrics display when driving begins.

For user-requested content, the behavior is more permissive, but driving restrictions still apply: visual content should switch to background audio while driving, and lyrics/video may be hidden.

---

## 4. What this means for the AICA simulator

The deck gives AICA a clear role:

> AICA should become the simulator that validates whether the proposed trigger logic, parameters, fire-control logic, proposal category selection, rest guidance, and recovery content behavior are feasible and acceptable.

The simulator should not only replay a fixed use case. It should let stakeholders change parameters and observe how the system behaves.

### Core simulator objects

AICA should model these objects explicitly:

| Simulator object | Meaning |
|---|---|
| Driver state | Drowsiness, fatigue, attention, response speed/prosody, recovery after rest/content. |
| Driving record | Trip time, distance, number of trips, long-distance tolerance. |
| Vehicle behavior | CAN anomalies, steering/pedal abnormality, lane departure, low-speed continuation. |
| Route context | Destination, highway length, monotonous road, tunnel, night, familiar route, scenic/unusual route. |
| Traffic/future fatigue | Congestion prediction, distance/time to congestion, distance/time until leaving congestion. |
| Rest opportunity | Rest place density, distance/time to next rest location, availability/crowding if modeled. |
| Passenger context | Friend, child, multiple passengers, child awake/sleeping. |
| User profile | Age/persona, preferences, oshi info, oshi mode, content history. |
| Proposal state | Last proposal time, result, proposal count, acceptance/rejection history. |
| Content state | Current content, content type, running/ended, visual/audio mode, driving/parked restrictions. |
| Evaluation labels | Too early, too late, appropriate, intrusive, safe, useful, accepted, rejected, recovered. |

### Minimal AICA trigger model

A practical V1 can use a scoring model:

```text
safety_risk_score =
  w_trip_time * trip_time_score
+ w_trip_distance * trip_distance_score
+ w_drowsiness * drowsiness_score
+ w_fatigue * fatigue_score
+ w_congestion * future_congestion_score
+ w_highway * long_highway_score
+ w_monotony * monotony_score
+ w_rest_gap * low_rest_opportunity_score
+ w_can_anomaly * driving_behavior_anomaly_score
```

Then derive proposal category:

```text
if safety_risk_score >= rest_required_threshold:
    category = Proposal ①: dangerous-driving prevention / rest proposal
elif safety_risk_score >= recovery_content_threshold or monotony_score is high:
    category = Proposal ②: monotony/fatigue recovery
elif route_emotional_score >= route_music_threshold:
    category = Proposal ③: route-based music
elif child_present_score >= child_threshold:
    category = Proposal ④: child-passenger proposal
else:
    category = No proposal
```

Fire-control logic should suppress low-urgency proposals but allow safety override:

```text
if category is low_or_medium_urgency:
    suppress if proposal interval too short or proposal count too high

if safety_risk_score greatly exceeds threshold or score slope is rising quickly:
    bypass suppression and fire rest proposal
```

### Key simulator screens

AICA should probably have five core screens:

1. **Scenario Playback**  
   Timeline of driving, fatigue, route, traffic, rest opportunities, and proposal events.

2. **Parameter Lab**  
   Sliders/tables for thresholds, weights, fire-control interval, proposal count, user acceptance tendency, recovery rate.

3. **Trigger Explanation Panel**  
   Shows why AIP fired or did not fire: features, weights, threshold crossing, slope, suppression/override.

4. **AIP Proposal Preview**  
   Shows the actual spoken/displayed proposal, rest location, content choices, and HMI mode.

5. **Human Review / Evidence Capture**  
   Allows stakeholders to label the result: too early, too late, appropriate, unsafe, intrusive, useful, accepted, rejected, needs new parameter, needs new requirement.

### Minimum V1 scope recommendation

The deck is broad. For a useful first AICA prototype, do not implement all content categories. Start with:

- Proposal ① only: rest recommendation due to fatigue/drowsiness.
- Include pre-rest content: hum-along karaoke or alert playlist until rest location.
- Include post-rest content: stretch, short karaoke, or live video after stop/nap.
- Include Proposal ② only as a competing branch: “light recovery content instead of rest.”
- Simulate 5–8 scenario patterns.
- Use deterministic rules/score first, not machine learning.

Suggested V1 scenario set:

1. Mild drowsiness, destination is near, no rest proposal.
2. Moderate drowsiness, long remaining route, light recovery content proposal.
3. Strong drowsiness, rest place nearby, immediate rest proposal.
4. Drowsiness increasing rapidly, proposal suppression is bypassed.
5. Recent proposal rejected, low-risk case is suppressed.
6. Recent proposal rejected, high-risk case still fires.
7. Temporary drowsiness recovers naturally before threshold crossing.
8. Persistent drowsiness, no nearby rest opportunity, early rest guidance required.

---

## 5. Gaps / issues to clarify before building AICA

The deck is strong as a concept and requirement seed, but it does not yet define enough to build a real simulator without assumptions.

### Missing or ambiguous items

1. **Feature formulas**  
   The deck names features but does not define units, ranges, normalization, decay, accumulation, or recovery behavior.

2. **Threshold values**  
   It mentions thresholds but does not provide concrete initial thresholds for rest, recovery content, route music, or child proposal.

3. **Feature weighting logic**  
   It mentions weights but does not define the initial weight table or how weights combine.

4. **Score slope / rapid increase logic**  
   It says fast increases may bypass fire-control, but does not define “fast.”

5. **Rest-place feasibility**  
   The deck asks whether the proposed rest place may be unavailable or crowded, but does not define the required data or fallback behavior.

6. **Recovery measurement**  
   Recovery rate is important for tuning, but the deck does not define how recovery is measured: camera, CAN, self-report, interaction quality, or post-rest driving stability.

7. **Content effect model**  
   It assumes content can suppress drowsiness or refresh the driver, but does not define expected effect size, duration, or risk of over-stimulation.

8. **Human review methodology**  
   The deck says simulator validation methodology is future work. AICA must define how humans judge whether behavior is good or bad.

9. **Proposal conflict resolution**  
   It says proposal categories are mutually exclusive in parts of the diagram, but real situations can overlap: sleepy driver + child passenger + scenic route + traffic.

10. **Safety/HMI constraints**  
    The deck notes driving restrictions, but AICA should explicitly represent which content modes are allowed while moving versus parked.

11. **Privacy/consent scope**  
    The deck uses camera, route history, oshi data, speech prosody, child detection, app histories, and schedules. Simulator requirements should include consent/data-governance assumptions.

---

## 6. Recommended AICA framing for brainstorming

AICA should be framed as:

> **AICA Trigger & Recovery Proposal Simulator** — a validation tool that helps product planners, domain experts, and stakeholders test whether AIP fatigue/drowsiness triggers, rest proposals, and content recovery flows are appropriate under many driver/route/context conditions.

AICA is not just a UI demo. It should generate evidence for requirement refinement.

### Main outputs from AICA

1. **Scenario result report**  
   What happened, why it happened, and whether the human reviewer judged it acceptable.

2. **Trigger evidence report**  
   Feature scores, weights, thresholds, suppression/override reason.

3. **Requirement change candidates**  
   Example: “Increase rest_required_threshold when destination is within 5 minutes unless drowsiness slope is high.”

4. **Parameter revision proposal**  
   Which thresholds/weights/fire-control values should change based on review labels.

5. **Open issue list**  
   Rest-place availability, content over-stimulation, legal HMI limits, child passenger conflicts, etc.

---

## 7. Planner conclusion

The deck provides a valuable initial requirements universe for AIP music/content proposals. For AICA, we should narrow the first simulator scope to the drowsiness/rest flow and treat the rest of the deck as context for future expansion.

The strongest next step is to convert the deck’s abstract model into a concrete simulator specification:

1. Define feature variables and ranges.
2. Define initial score formulas and thresholds.
3. Define fire-control rules.
4. Define scenario matrix.
5. Define UI screens and evidence outputs.
6. Define human evaluation labels.
7. Define how simulator feedback updates requirements.

In short:

> The PowerPoint is a concept/requirements seed. AICA should become the evidence engine that tests and refines its trigger logic.

---

## Appendix A — Slide title map

| Slide | Japanese title / detected title | English meaning |
|---:|---|---|
| 1 | 音楽企画 身体的な疲労・眠気検知時の休憩提案（休憩所まで） | Music planning: rest proposal when physical fatigue/drowsiness is detected — until the rest location |
| 2 | 音楽企画 身体的な疲労・眠気検知時の休憩提案（コンテンツ提案まで） | Rest proposal when fatigue/drowsiness is detected — up to content proposal |
| 3 | 音楽企画 身体的な疲労・眠気検知時の休憩提案（カラオケ選択） | Rest proposal — karaoke selection |
| 4 | 音楽企画 身体的な疲労・眠気検知時の休憩提案（限定ライブ映像） | Rest proposal — limited live video |
| 5 | 音楽企画 身体的な疲労・眠気検知時の休憩提案（推しスポット追体験） | Rest proposal — oshi spot re-experience |
| 6 | 音楽企画 身体的な疲労・眠気検知時の休憩提案（ストレッチ動画） | Rest proposal — stretch video scenario 1 |
| 7 | 音楽企画 身体的な疲労・眠気検知時の休憩提案（ストレッチ動画） | Rest proposal — stretch video scenario 2 |
| 8 | 音楽企画 子供同乗時の車内体験向上のためのコンテンツ提案（自宅動画再生） | Child-passenger cabin experience proposal — resume home video |
| 9 | 音楽企画 子供同乗時の車内体験向上のためのコンテンツ提案（動画レコ） | Child-passenger cabin experience proposal — video recommendation |
| 10 | 音楽企画 単調・慣れによる漫然予兆への車内回復提案（コンテンツ提案まで） | In-car recovery proposal for mindless-driving signs caused by monotony/familiarity — up to content proposal |
| 11 | 音楽企画 単調・慣れによる漫然予兆への車内回復提案（プレイリスト作成） | Monotony/familiarity recovery proposal — playlist creation |
| 12 | 音楽企画 単調・慣れによる漫然予兆への車内回復提案（鼻歌カラオケ） | Monotony/familiarity recovery proposal — hum-along karaoke |
| 13 | 音楽企画 単調・慣れによる漫然予兆への車内回復提案（クイズ） | Monotony/familiarity recovery proposal — quiz |
| 14 | 音楽企画 単調・慣れによる漫然予兆への車内回復提案（ラジオ風配信） | Monotony/familiarity recovery proposal — radio-style delivery |
| 15 | 音楽企画 単調・慣れによる漫然予兆への車内回復提案（合いの手練習） | Monotony/familiarity recovery proposal — call-and-response practice |
| 16 | 音楽企画 単調・慣れによる漫然予兆への車内回復提案（ランキング作成） | Monotony/familiarity recovery proposal — ranking creation |
| 17 | 音楽企画 注意力低下の検知時の車内回復提案 | In-car recovery proposal when attention decline is detected |
| 18 | 音楽企画 | Functional placement / architecture overview |
| 19 | 音楽企画 漫然運転予防用コンテンツ提案（1/3）フローチャート | Flowchart: mindless-driving prevention content proposal 1/3 |
| 20 | 音楽企画 漫然運転予防用コンテンツ提案（2/3）フローチャート | Flowchart: mindless-driving prevention content proposal 2/3 |
| 21 | 音楽企画 漫然運転予防用コンテンツ提案（3/3）フローチャート | Flowchart: mindless-driving prevention content proposal 3/3 |
| 22 | 音楽企画 漫然運転予防用コンテンツ提案（1/4）シーケンス図 | Sequence: mindless-driving prevention content proposal 1/4 |
| 23 | 音楽企画 漫然運転予防用コンテンツ提案（2/4）シーケンス図 | Sequence: mindless-driving prevention content proposal 2/4 |
| 24 | 音楽企画 漫然運転予防用コンテンツ提案（3/4）シーケンス図 | Sequence: mindless-driving prevention content proposal 3/4 |
| 25 | 音楽企画 漫然運転予防用コンテンツ提案（4/4）シーケンス図 | Sequence: mindless-driving prevention content proposal 4/4 |
| 26 | 音楽企画におけるAIP提案機能の全体像 | Overall view of the AIP proposal function in music planning |
| 27 | 音楽企画におけるAIP提案機能の全体像 | Overall view of the AIP proposal function with section markers |
| 28 | ① AIP提案におけるトリガー検知・発火 | Section: trigger detection and firing in AIP proposals |
| 29 | AIP提案におけるトリガー検知・発火の流れ | Flow of trigger detection and firing in AIP proposals |
| 30 | トリガー検知・発火に必要なデータ定義 | Data definitions required for trigger detection and firing |
| 31 | トリガー検知対象の特徴量・監視データ（1/2） | Features and monitoring data for trigger detection 1/2 |
| 32 | トリガー検知対象の特徴量・監視データ（2/2） | Features and monitoring data for trigger detection 2/2 |
| 33 | チューニング用分析データおよび対象について | Analysis data and targets for tuning |
| 34 | 発火制御について | Fire-control / proposal suppression |
| 35 | 提案分類・概要について | Proposal categories and overview |
| 36 | トリガー検知・発火領域の今後の検討事項 | Future study items for trigger detection/firing |
| 37 | ②提案コンテンツ概要・UX | Section: proposal content overview and UX |
| 38 | コンテンツ分類・目的 | Content categories and purposes |
| 39 | コンテンツ概要一覧（走行中コンテンツ） | Content overview list — driving content |
| 40 | コンテンツ概要一覧（停車中コンテンツ） | Content overview list — parked content |
| 41 | プレイリスト再生 主要UC（走行中AI提案時） | Playlist playback main use case — AI proposal while driving |
| 42 | プレイリスト再生の終了を要望 | Request to end playlist playback |
| 43 | 鼻歌カラオケ 主要UC（走行中AI提案時） | Hum-along karaoke main use case — AI proposal while driving |
| 44 | 鼻歌カラオケの終了を要望 | Request to end hum-along karaoke |
| 45 | 合いの手練習 主要UC（走行中AI提案時） | Call-and-response practice main use case — AI proposal while driving |
| 46 | 合いの手練習 主要UC（走行中AI提案時）※要休憩 | Call-and-response practice main use case — rest required |
| 47 | 合いの手練習動画再生の終了を要望 | Request to end call-and-response video playback |
| 48 | クイズ 主要UC（走行中AI提案時） | Quiz main use case — AI proposal while driving |
| 49 | クイズ作成・読み上げ・結果FB | Quiz creation, reading aloud, feedback, score, app transfer |
| 50 | ランキング 主要UC（走行中AI提案時） | Ranking creation main use case — AI proposal while driving |
| 51 | ランキング作成・アプリ転送 | Ranking creation and app transfer |
| 52 | ラジオ風再生 主要UC（走行中AI提案時） | Radio-style playback main use case — AI proposal while driving |
| 53 | 再生終了後、別コンテンツ実施を確認 | Confirm another content after radio playback ends |
| 54 | ライブビューイング 主要UC（走行中AI提案時） | Live viewing main use case — AI proposal while driving |
| 55 | ライブビューイングの終了を要望 | Request to end live viewing |
| 56 | ストレッチ動画 主要UC（走行中AI提案時） | Stretch video main use case — AI proposal while driving |
| 57 | 休憩必要性が高い場合の休憩場所移動提案 | Suggest moving to a rest location when rest need is high |
| 58 | カラオケ 主要UC（走行中AI提案時） | Full karaoke main use case — AI proposal while driving |
| 59 | 1曲歌唱終了後の挙動 | Behavior after one karaoke song ends |
| 60 | 推し追体験 主要UC（走行中AI提案時） | Oshi re-experience main use case — AI proposal while driving |
| 61 | 推しスポット検索・目的地設定・ナビ開始 | Search oshi spot, set destination, start navigation |
| 62 | 参考）子供同乗時の提案コンテンツについて | Reference: proposal content when a child is onboard |
| 63 | ③コンテンツ提供方式・終了判断 | Section: content provision method and end judgment |
| 64 | コンテンツ提供～終了時における流れ（提案①） | Flow from content provision to end — Proposal ① |
| 65 | コンテンツ提供～終了時における流れ（提案②～④） | Flow from content provision to end — Proposals ②–④ |
| 66 | コンテンツ案の表示順決めプロセス・分析データ | Process and analysis data for determining content display order |
| 67 | 提案コンテンツ優先度判断材料 | Materials for judging proposed-content priority |
| 68 | コンテンツ具体内容検討プロセス・分析データ | Process and analysis data for detailed content selection |
| 69 | 具体コンテンツ選択判断材料 | Materials for concrete content selection |
| 70 | 具体コンテンツ選択材料対象 | Target input data for concrete content selection |
| 71 | プレイリスト再生 コンテンツ選択判断インプット | Playlist playback selection inputs |
| 72 | 鼻歌カラオケ コンテンツ選択判断インプット | Hum-along karaoke selection inputs |
| 73 | 合いの手練習 コンテンツ選択判断インプット | Call-and-response practice selection inputs |
| 74 | クイズ コンテンツ選択判断インプット | Quiz selection inputs |
| 75 | ランキング コンテンツ選択判断インプット | Ranking selection inputs |
| 76 | ラジオ風再生 コンテンツ選択判断インプット | Radio-style playback selection inputs |
| 77 | ライブビューイング コンテンツ選択判断インプット | Live viewing selection inputs |
| 78 | ストレッチ動画 コンテンツ選択判断インプット | Stretch video selection inputs |
| 79 | カラオケ コンテンツ選択判断インプット | Karaoke selection inputs |
| 80 | 推し追体験 コンテンツ選択判断インプット | Oshi re-experience selection inputs |
| 81 | AI提案開始時のコンテンツ提供内容及び終了条件整理 | Content provision and end-condition summary when started by AI proposal |
| 82 | ユーザー要望開始時のコンテンツ提供内容及び終了条件整理 | Content provision and end-condition summary when started by user request |
