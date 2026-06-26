# UC-03 — In-car Recovery Proposal for Signs of Monotony / Habituation

## 1. Source Use Case

**Original title:** UC-03.単調・慣れによる漫然予兆への車内回復提案【レビュー済】  
**English title:** In-car Recovery Proposal for Signs of Monotony / Habituation  
**Target MVP:** In-car AICA(AI cockpit assistant) recovery proposal service  
**Use-case role:** Scenario module for validating monotony detection, congestion/route context, shared oshi content, low-burden engagement, and safe in-driving content proposals.

---

## 2. Situation Overview

### UC-03-01: A, late-50s female, returning home with daughter C

A is driving home from a large shopping mall with her daughter C in the passenger seat at around 17:30 on Saturday.

They are on a familiar major road that they have used many times. The scenery is familiar, and due to evening traffic around the shopping mall, there is little change in signals, scenery, or traffic flow.

Shopping was enjoyable, but both A and C are somewhat tired.

A and her daughter both support a domestic idol group, and they are looking forward to attending a live concert together in about one month.

### UC-03-02: B, early-30s male, highway business trip

B is driving on a highway on a weekday morning to a business trip destination in the same prefecture, about two hours one way.

He is not bad at driving and uses ADAS while maintaining a constant speed. However, as he continues through a long section with little change in scenery, stimulation gradually decreases.

Although music is playing, it no longer remains in his awareness. While following the same lane and similar scenery, he realizes that his head has become foggy and that the last few minutes of memory are vague.

B feels the issue of reduced concentration caused by monotonous highway driving.

---

## 3. Main Actors

| Actor | Role |
|---|---|
| A | Driver in UC-03-01, late-50s female |
| C | Passenger in UC-03-01, A's daughter |
| B | Driver in UC-03-02, early-30s male |
| AICA(AI cockpit assistant) | In-car AI partner that detects monotony or congestion context and proposes recovery content |

---

## 4. Main Scenario: UC-03-01

### Step 1 — Register oshi information

A and C enter favorite-artist / oshi information through the oshi-katsu app introduced at purchase.

**System / AICA(AI cockpit assistant) action**

- Registers user information.
- Links user and oshi information on the server.

### Step 2 — ReadyON at shopping mall

A gets into the car and turns ReadyON. C gets into the passenger seat.

**State**

- Emotion: Neutral
- Vehicle: stopped safely in shopping mall parking lot
- Input data: UserProfile

**System / AICA(AI cockpit assistant) action**

- Retrieves oshi information from registered user profile.

### Step 3 — Destination set to home and playlist proposal

A sets home as the destination.

AICA(AI cockpit assistant) says:

> This is your usual route home. Since your favorite artist's live show is coming soon, shall I play a playlist that helps you enjoy the usual way home without getting bored?

**Input data candidates**

- Destination
- Passenger information
- A and C oshi information
- A and C live-ticket acquisition status

**System / AICA(AI cockpit assistant) action**

- Detects a familiar return-home scene from the usual shopping mall to home.
- Proposes music playback so the familiar route does not feel boring.

### Step 4 — A and C accept the playlist

C says:

> Oh, I am curious! I want to listen.

A says:

> Sounds good. Please.

AICA(AI cockpit assistant) says:

> OK. I will play a calm playlist for the way home, based on the concept of your favorite artist's live show [performance name].

**System / AICA(AI cockpit assistant) action**

- Retrieves information about the concept of the live show.
- Selects songs from the favorite artist's songs that fit the return-home scene.
- Creates a playlist.

**Open issue**

- Third-party collaboration and development scope are still under consideration.

### Step 5 — AICA(AI cockpit assistant) detects traffic congestion

AICA(AI cockpit assistant) says:

> There may be congestion ahead for a while due to the evening rush.

A says:

> As expected, it is crowded.

**State**

- Emotion: Happy → irritated
- Vehicle: immediately after departure from shopping mall

**System / AICA(AI cockpit assistant) action**

- Detects congestion and informs the user.

### Step 6 — AICA(AI cockpit assistant) proposes content to make congestion more enjoyable

AICA(AI cockpit assistant) says:

> If you like, I can suggest content to make this congestion time a little more enjoyable. For example, I can make a playlist with a different mood, play humming karaoke that both of you can enjoy casually, or give a simple quiz about your favorite artist. Since the live show is coming soon, we can also practice call-and-response.

**Input data candidates**

- Vehicle speed
- Congestion information
- A and C oshi information
- A and C live-ticket acquisition status

**System / AICA(AI cockpit assistant) action**

- Detects that the vehicle is not moving much based on congestion and speed.
- Creates proposals based on shared oshi content to help maintain attention.

**Content candidates**

1. Different playlist to change the mood
2. Casual humming karaoke
3. Oshi quiz
4. Radio-style delivery of latest oshi information
5. Call-and-response practice before the live show

---

## 5. Branches

### Branch 1 — Different playlist

A chooses a different playlist.

**System / AICA(AI cockpit assistant) action**

- Recreates a playlist suitable for the congestion and return-home scene.
- Explains the playlist theme, such as calm songs suitable for an evening drive.
- When congestion ends, resumes the original playlist from the interrupted point.

### Branch 2 — Humming karaoke

C wants to do karaoke, and AICA(AI cockpit assistant) asks whether to include only oshi songs or other songs too.

**System / AICA(AI cockpit assistant) action**

- Creates a karaoke playlist based on A and C's age range and preferred music genres.
- Tries to balance songs for both occupants.
- Starts a karaoke app and plays/reserves songs in order.
- Whether this should be a dedicated in-car app or an OTT app remains under consideration.

### Branch 3 — Oshi quiz

C chooses the quiz.

**System / AICA(AI cockpit assistant) action**

- Creates a short, voice-first quiz that does not require screen attention.
- If it is a non-correct-answer quiz, creates a ranking.
- When congestion ends, shares the top results and sends the rest to the oshi-katsu app.
- If it is a correct-answer quiz, reads out the answer rate and makes explanations available in the oshi-katsu app.

### Branch 4 — Radio-style oshi information

A chooses to listen to the latest information about the oshi.

**System / AICA(AI cockpit assistant) action**

- Summarizes updated oshi-related information since the previous delivery in about one minute.
- If there is goods, CD, or ticket sales information, instructs the smartphone app to create a purchase list based on previous purchase history.
- After delivery, if congestion has not cleared, returns to other content proposals.

### Branch 5 — Call-and-response practice

A chooses call-and-response practice.

**System / AICA(AI cockpit assistant) action**

- Searches YouTube for official call videos.
- Plays the call video in the background.
- Changes cabin illumination color according to the call timing.
- When congestion ends, returns to the original playlist flow.

---

## 6. Secondary Scenario: UC-03-02

B drives on a highway to a business-trip destination for about two hours.

Potential system direction:

1. Detect prolonged monotonous driving and reduced stimulation.
2. Detect possible attention decline or unclear memory of recent minutes.
3. Propose low-burden audio-first recovery content.
4. Avoid visual content or complex interaction during highway driving.
5. Use ADAS/highway context, driving duration, road monotony, and attention signals as trigger inputs.

---

## 7. Input Data Candidates

| Category | Data |
|---|---|
| User profile | Age, gender, oshi information, music preferences |
| Passenger | Passenger presence, shared oshi information |
| Route context | Destination, usual route, shopping mall-to-home context, highway business-trip route |
| Traffic context | Congestion information, vehicle speed, congestion end detection |
| Event context | Live-ticket status, performance name, live show concept |
| Content data | Oshi songs, playlists, YouTube call videos, latest oshi news |
| Driving state | Monotony, attention decline, ADAS usage, long constant-speed driving |
| App integration | Oshi-katsu app, possible karaoke app, smartphone app for results and shopping list |

---

## 8. Candidate Hypotheses

```text
H-MONO-001:
AICA(AI cockpit assistant) should intervene when monotony or habituation increases attention decline risk.

H-CONTENT-001:
Audio-based engagement content can help recover attention during monotonous or congested driving.

H-UX-001:
During driving, proposed content should be low interaction and should not require visual attention.

H-PERS-001:
Favorite-artist or preference-based content increases acceptance if delivered in a safe modality.

H-PASS-001:
When a passenger shares the same oshi interest, shared content can improve cabin engagement.

H-SAFE-001:
Lyrics, videos, or visually demanding content should be restricted while the vehicle is moving.
```

---

## 9. Requirement Candidate Seeds

```text
REQ-TRG-001:
AICA(AI cockpit assistant) shall detect monotonous or low-stimulation driving contexts using route, traffic, vehicle speed, and driving duration signals.

REQ-TRG-002:
AICA(AI cockpit assistant) shall detect congestion context and low vehicle movement before proposing congestion-time engagement content.

REQ-UX-001:
AICA(AI cockpit assistant) shall propose audio-first, low-interaction content while the vehicle is moving.

REQ-CONTENT-001:
AICA(AI cockpit assistant) shall be able to generate context-specific playlists based on oshi information, live event context, and driving scene.

REQ-CONTENT-002:
AICA(AI cockpit assistant) shall be able to propose multiple safe engagement content types, including playlist, humming karaoke, quiz, radio-style information, and call practice.

REQ-SAFE-001:
AICA(AI cockpit assistant) shall avoid content that requires visual attention while driving.

REQ-APP-001:
Results such as quiz rankings or shopping lists may be transferred to the smartphone oshi-katsu app for later review.
```

---

## 10. Validation Artifact Ideas

| Validation Target | Artifact |
|---|---|
| Monotony / congestion trigger | Trigger condition matrix + scenario variants |
| Content choice burden | Multi-option vs one recommendation comparison |
| Audio-only safety | Playback review comparing audio-first vs screen-heavy content |
| Passenger shared engagement | Scenario playback with A and C reactions |
| Personalization relevance | Playlist / quiz / radio content comparison |
| App handoff | Smartphone-app handoff storyboard |

---

## 11. Open Issues

```text
- How should monotony or habituation be detected reliably?
- How should the system distinguish congestion boredom from safety-critical attention decline?
- Which content types are acceptable while driving?
- Should AICA(AI cockpit assistant) present many content options or recommend one primary option?
- How should the system handle driver-only vs passenger-present situations?
- What content can be generated directly in-vehicle, and what requires third-party services?
- Should call-and-response practice be allowed during driving, even if audio-first?
```
