# UC-02 — In-car Recovery Proposal for an Unstable Environment with a Child Passenger

## 1. Source Use Case

**Original title:** UC-02.子供同乗による不安定環境への車内回復提案【レビュー済】  
**English title:** In-car Recovery Proposal for an Unstable Environment with a Child Passenger  
**Target MVP:** In-car AICA(AI cockpit assistant) recovery proposal service  
**Use-case role:** Scenario module for validating passenger context recognition, rear-seat content continuation, driver stress reduction, and safety of passenger-facing content.

---

## 2. Situation Overview

B is an early-30s male. On days when he takes his child to nursery school, the morning is always busy.

Before departure, the child is watching a favorite video at home. However, when the child is watching the video, it becomes hard to get the child to move. When it is time to leave and they go out together, the child becomes upset and starts whining.

Because there is little time to spare, B must manage the child's mood while departing. This makes him irritated and reduces his ability to concentrate on driving.

AICA(AI cockpit assistant) detects that a child passenger is onboard and proposes continuing the child's recently watched video on the rear-seat monitor.

---

## 3. Main Actors

| Actor | Role |
|---|---|
| B | Driver, early-30s male, father taking child to nursery school |
| Child | Rear-seat passenger who wants to continue watching a video |
| AICA(AI cockpit assistant) | In-car AI partner that detects passenger context and proposes cabin recovery action |

---

## 4. Main Scenario

### Step 1 — Link user profile and YouTube account

B links his UserProfile with his YouTube account.

**System / AICA(AI cockpit assistant) action**

- Links UserProfile and YouTube account.
- Enables retrieval of recent viewing history.

### Step 2 — Child wants to continue the video

Child says:

> I want to watch the rest of the video from earlier!

B says:

> We are in a hurry now, so watch it in the car. Sit in your seat.

**State**

- Location: Home
- Vehicle: Safely stopped
- Driver stress: beginning to rise

### Step 3 — Child gets into the rear child seat

The child gets into the rear child seat. B gets into the vehicle and turns ReadyON.

**State**

- Driver emotion: rushed / anxious
- Vehicle: safely stopped at home
- Input data: UserProfile, seat occupancy / passenger information

**System / AICA(AI cockpit assistant) action**

- Detects that a child has entered the rear seat.

### Step 4 — AICA(AI cockpit assistant) proposes continuing the YouTube video on rear-seat display

AICA(AI cockpit assistant) says:

> Would you like to continue the YouTube video you were watching at home on the rear-seat entertainment screen or rear monitor? It can start from where it left off.

B says:

> Please. Start from where it left off.

**State**

- Driver emotion: rushed → neutral
- Vehicle: safely stopped at home

**Input data**

- Passenger information
- YouTube playback history

**System / AICA(AI cockpit assistant) action**

- Retrieves recent YouTube playback history from registered user information.
- After user consent, starts playback from the previous position.
- Provides audio volume and sound field suitable for the rear-seat experience.

### Step 5 — B starts driving without setting a destination

B starts driving without setting a destination.

**State**

- Driver emotion: neutral
- Vehicle: immediately after departure from home

**System / AICA(AI cockpit assistant) action**

- Keeps rear-seat content active.
- Supports a calmer cabin environment so B can focus on driving.

---

## 5. Input Data Candidates

| Category | Data |
|---|---|
| User account | UserProfile, YouTube account linkage |
| Passenger context | Rear-seat occupancy, child passenger detection |
| Content history | Most recent YouTube playback history, playback position |
| Vehicle state | Stopped / driving state |
| Consent | Driver approval to resume content |
| Output device | Rear-seat entertainment screen or rear monitor |
| Audio environment | Rear-seat suitable volume and sound field |

---

## 6. Candidate Hypotheses

```text
H-PASS-001:
AICA(AI cockpit assistant) should consider passenger state, not only driver state, when deciding whether to intervene.

H-CONTENT-001:
Continuing familiar content from home can reduce child passenger dissatisfaction during departure.

H-DRIVER-001:
Reducing child passenger instability also reduces driver stress and improves driving concentration.

H-SAFE-002:
Passenger-facing content should not increase driver distraction.

H-CONSENT-001:
AICA(AI cockpit assistant) should ask driver consent before continuing external content in the vehicle.
```

---

## 7. Requirement Candidate Seeds

```text
REQ-PASS-001:
AICA(AI cockpit assistant) shall detect when a child passenger is onboard in the rear seat.

REQ-CONTENT-001:
AICA(AI cockpit assistant) shall retrieve recently watched content history when the user account is linked and consent is available.

REQ-CONTENT-002:
AICA(AI cockpit assistant) shall be able to resume video playback from the previous position on a rear-seat display.

REQ-UX-001:
AICA(AI cockpit assistant) shall ask for driver consent before starting rear-seat content playback.

REQ-SAFE-001:
Passenger-facing video playback shall not require driver visual attention.

REQ-AUDIO-001:
AICA(AI cockpit assistant) shall adjust audio volume and sound field for the rear-seat experience.
```

---

## 8. Validation Artifact Ideas

| Validation Target | Artifact |
|---|---|
| Passenger-context intervention | Playback simulator showing child mood before and after AICA(AI cockpit assistant) proposal |
| Consent UX | Micro-prototype comparing automatic resume vs consent-first proposal |
| Safety | Review matrix for rear-seat video playback while driver is driving |
| Data feasibility | Data availability matrix for YouTube history, passenger detection, and account linkage |
| Driver stress reduction | Scenario review with driver state before/after cabin recovery |

---

## 9. Open Issues

```text
- How should the system reliably detect that a child passenger is onboard?
- Which devices are valid output devices: RSE, rear monitor, tablet, or smartphone?
- What consent is required before continuing content?
- What should happen if the linked content account is unavailable?
- How should AICA(AI cockpit assistant) avoid distracting the driver while content plays in the rear seat?
- Should the system also propose non-video alternatives if video is not available?
```
