# UC-01 — Rest Proposal When Physical Fatigue / Drowsiness Is Detected

## 1. Source Use Case

**Original title:** UC-01.身体的な疲労・眠気検知時の休憩提案【レビュー済】  
**English title:** Rest Proposal When Physical Fatigue / Drowsiness Is Detected  
**Target MVP:** In-car AICA(AI cockpit assistant) recovery proposal service  
**Use-case role:** Scenario module for validating fatigue/drowsiness trigger timing, rest proposal UX, personalization timing, and recovery flow.

---

## 2. Situation Overview

### UC-01-01: C, early-20s female, driving home with a friend

C is driving home after going out with a friend. It is approaching evening. She slept poorly the night before and is physically tired.

However, she is still excited from spending time with her friend and is enjoying the conversation. Because her mood is still high, she has low self-awareness of her own fatigue and thinks she can continue driving.

AICA(AI cockpit assistant) detects signs of fatigue or drowsiness and proposes a rest in a way that uses C's favorite-artist / oshi preference context.

### UC-01-02: B, early-30s male, driving home alone after overtime

B is driving home alone late at night after overtime work. His head feels tired and foggy after work.

He wants to go home quickly, rest, and see his family, so he does not want to make unnecessary stops. He tends to perceive rest as a time loss.

In this branch, the system should propose a very short, practical rest action that fits his desire to return home quickly.

---

## 3. Main Actors

| Actor | Role |
|---|---|
| C | Driver in UC-01-01. Early-20s female, tired but emotionally excited. |
| Friend | Passenger in UC-01-01. Shares C's oshi interest. |
| B | Driver in UC-01-02. Early-30s male, tired after overtime and wants to go home quickly. |
| AICA(AI cockpit assistant) | In-car AI partner that detects fatigue/drowsiness and proposes recovery actions. |

---

## 4. Main Scenario: UC-01-01

### Step 1 — Register oshi information

C enters favorite-artist / oshi information through the oshi-katsu app introduced at purchase.

**System / AICA(AI cockpit assistant) action**

- Registers user information.
- Links user profile and oshi information on the server.

### Step 2 — Turn on oshi-katsu mode

Before going out, C turns on `oshi-katsu mode` from the vehicle because she and her friend support the same artist.

**System / AICA(AI cockpit assistant) action**

- Oshi-katsu mode is turned on.
- AICA(AI cockpit assistant) can use oshi information as input for future proposals.
- Personalization level may be selectable so the system can consider differences between C and her friend, such as enthusiasm level, future event participation, and past experience.

### Step 3 — ReadyON with friend onboard

C gets into the car and turns ReadyON. Her friend gets into the passenger seat.

**State**

- Emotion: Neutral
- Fatigue: Neutral
- Vehicle: Safely stopped at outing location
- Input data: UserProfile

**System / AICA(AI cockpit assistant) action**

- Retrieves registered user information, such as age, gender, frequently visited places, and oshi information.

### Step 4 — Driving starts

C and her friend begin driving. Their conversation is lively.

**State**

- Emotion: Happy / enjoying conversation
- Fatigue: Neutral
- Vehicle: Immediately after departure

### Step 5 — AICA(AI cockpit assistant) detects drowsiness signs and proposes rest

AICA(AI cockpit assistant) says:

> I am seeing some signs of drowsiness. You can continue home, but if you rest now, you may be able to get home more comfortably and safely.

**State**

- Emotion: Happy
- Fatigue: Neutral → tired
- Vehicle: Driving

**Input data candidates**

- Driving time
- User state / drowsiness
- Steering instability
- Cabin camera signal
- Steering operation behavior

**System / AICA(AI cockpit assistant) action**

- Detects user fatigue or drowsiness.
- Proposes rest.

**Notes**

Possible detection examples:

- About 1.5 hours have passed since driving started.
- Cabin camera or steering behavior indicates drowsiness or reduced concentration.

### Step 6 — AICA(AI cockpit assistant) presents three personalized rest options

AICA(AI cockpit assistant) says:

> Based on your preferences, I prepared three rest methods.  
> 1. 15-minute nap → karaoke after the nap  
> 2. 15-minute nap → limited live video of your favorite artist after the nap  
> 3. Rest at a nearby oshi-related spot → nap + experience guidance after arrival  
> Which one would you like? You can change it on the way.

**Input data candidates**

- Oshi-katsu mode setting
- C's oshi target
- Oshi sacred-place / related spot information
- Nearby facility information
- Business hours of proposed spots
- Past rest-method selection history
- Estimated arrival time at destination

**System / AICA(AI cockpit assistant) action**

- Based on oshi-katsu mode, surrounding facility information, and C's past selection history, AICA(AI cockpit assistant) proposes three options.
- If the rest spot arrival time and destination arrival time are almost the same, destination guidance should be prioritized.

### Step 7 — User selects a rest option

C selects one of the three options. Her friend reacts positively.

AICA(AI cockpit assistant) says:

> Understood. I will guide you to a rest spot where you can enjoy the selected rest method.

**System / AICA(AI cockpit assistant) action**

- Registers the selected rest spot as a waypoint.
- Updates route guidance.

### Step 8 — AICA(AI cockpit assistant) supports alertness until arrival

AICA(AI cockpit assistant) says:

> The rest spot is about 10 minutes away. To reduce drowsiness, I will play humming karaoke and high-awakening music.

**System / AICA(AI cockpit assistant) action**

- Plays humming karaoke mainly through audio guidance.
- Does not show lyrics while driving.
- Uses music to support recovery until the rest spot.

### Step 9 — Arrival and nap mode

AICA(AI cockpit assistant) says:

> We have arrived at the rest spot. First, let's rest your body. I will wake you up in 15 minutes. I will dim the lights.

**State**

- Emotion: Happy → Neutral
- Fatigue: Tired → relaxed
- Vehicle: Arrived and stopped
- Input data: location, vehicle speed, shift position D → P

**System / AICA(AI cockpit assistant) action**

- Detects arrival and stopped state.
- Enters relaxation mode for nap.
- Adjusts seat position, illumination, multimedia screen, BGM, and volume.
- Sets a 15-minute timer.

### Step 10-A — After nap: karaoke selected

AICA(AI cockpit assistant) suggests a first karaoke song after the 15-minute nap.

**System / AICA(AI cockpit assistant) action**

- Changes seat position for screen visibility.
- Shows karaoke video + lyrics only while stopped.
- Switches from relaxation BGM to the recommended karaoke song.
- Keeps volume moderate and provides a song-matched sound field.

### Step 10-B — After nap: limited live video selected

AICA(AI cockpit assistant) plays a limited live video after the 15-minute nap.

**System / AICA(AI cockpit assistant) action**

- Adjusts seat position for viewing.
- Synchronizes illumination with video production.
- Enables video only while stopped.
- Switches BGM to oshi music.
- Gradually increases volume to match the live atmosphere.

### Step 10-C — After nap: oshi-related spot selected

AICA(AI cockpit assistant) explains that the current place is related to an episode involving the user's oshi and proposes a local experience.

**System / AICA(AI cockpit assistant) action**

- Provides episode information related to the oshi and the place.
- Provides video, image, or SNS URL.
- Provides distance and route to the actual place.
- Sends route/reference information to the smartphone.

---

## 5. Secondary Scenario: UC-01-02

### Situation

B is driving home alone after overtime. It is late at night. He is tired and foggy, but wants to go home quickly and sees rest as time loss.

### Main Flow

1. AICA(AI cockpit assistant) detects B's fatigue state and that his destination is home.
2. AICA(AI cockpit assistant) proposes a short three-minute stretch at a convenience store on the shortest route.
3. B accepts because the intervention is short.
4. AICA(AI cockpit assistant) adds the convenience store as a waypoint and keeps the home destination.
5. While driving to the convenience store, AICA(AI cockpit assistant) plays humming karaoke or alertness-supporting music.
6. At the convenience store, AICA(AI cockpit assistant) plays a seated stretch video for three minutes.
7. AICA(AI cockpit assistant) shares that B's refresh level has improved and resumes guidance home.

---

## 6. Input Data Candidates

| Category | Data |
|---|---|
| User profile | Age, gender, common destinations, oshi information |
| Preference | Oshi-katsu mode, personalization level, past rest-method choices |
| Driver state | Drowsiness, fatigue, concentration, possible cabin camera signal |
| Vehicle behavior | Driving time, steering instability, vehicle speed, shift position |
| Route context | Destination, ETA, nearby facilities, rest spot distance |
| Facility data | Business hours, available rest locations, oshi-related spot information |
| Content data | Karaoke ranking, commonly sung songs, live video availability, oshi spot episode data |

---

## 7. Candidate Hypotheses

```text
H-TRG-001:
AICA(AI cockpit assistant) should propose rest only when fatigue or drowsiness signs persist or repeat, not immediately after the first weak signal.

H-TRG-002:
AICA(AI cockpit assistant) should consider route context and practical rest availability before proposing rest.

H-UX-001:
When the driver is tired, one low-cognitive-load recommendation may be better than multiple personalized options while driving.

H-PERS-001:
Personalized recovery content is useful, but should be shown after stopping or when cognitive load is low.

H-SAFE-001:
Lyrics, video, and attention-heavy content should be suppressed while the vehicle is moving.

H-DATA-001:
Driving time, user state, steering behavior, and route context are candidate inputs for fatigue/drowsiness intervention.
```

---

## 8. Requirement Candidate Seeds

```text
REQ-TRG-001:
AICA(AI cockpit assistant) shall evaluate fatigue/drowsiness over a configurable observation window.

REQ-TRG-002:
AICA(AI cockpit assistant) shall propose rest when fatigue/drowsiness signs persist or repeat and a practical rest action is available.

REQ-TRG-003:
AICA(AI cockpit assistant) shall consider route context, such as destination ETA and nearby rest spot availability, before proposing rest.

REQ-UX-001:
While the vehicle is moving, AICA(AI cockpit assistant) shall avoid presenting attention-heavy visual choices.

REQ-UX-002:
AICA(AI cockpit assistant) shall explain the reason for the rest proposal in a gentle and optional tone.

REQ-CONTENT-001:
Personalized content such as karaoke, live video, or oshi-related experience may be proposed after the vehicle is stopped.

REQ-SAFE-001:
Video and lyrics display shall be enabled only when the vehicle is safely stopped.
```

---

## 9. Validation Artifact Ideas

| Validation Target | Artifact |
|---|---|
| Trigger timing | Trigger condition test matrix + playback drill-down |
| Three options vs one recommendation | Side-by-side comparison prototype |
| Personalization timing | Timeline comparison: while driving vs after stopping |
| Safety modality | Visual vs audio-only review playback |
| B scenario practicality | Short-rest intervention simulation |

---

## 10. Open Issues

```text
- What exact fatigue/drowsiness threshold should trigger AICA(AI cockpit assistant) intervention?
- Should the system require repeated signals or a time-based observation window?
- How should the system choose between destination priority and rest proposal priority?
- Should three personalized options be shown while driving, or should AICA(AI cockpit assistant) recommend only one action?
- Which data sources are reliable enough for final specification?
- How should personalization level be controlled when a passenger is present?
```
