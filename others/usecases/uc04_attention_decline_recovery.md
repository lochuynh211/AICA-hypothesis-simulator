# UC-04 — In-car Recovery Proposal When Attention Decline Is Detected

## 1. Source Use Case

**Original title:** UC-04.注意力低下の検知時の車内回復提案【レビュー済】  
**English title:** In-car Recovery Proposal When Attention Decline Is Detected  
**Target MVP:** In-car AICA(AI cockpit assistant) recovery proposal service  
**Use-case role:** Scenario module for validating soft attention recovery, cognitive-load-aware dialogue, environmental adjustment, and gentle AICA(AI cockpit assistant) tone.

---

## 2. Situation Overview

A is a late-50s female driving home after shopping.

It is evening. Her head is full of household tasks, such as "What should I cook first today?" and "I also need to do laundry when I get home."

She is driving on a familiar road and is somewhat on autopilot mentally.

AICA(AI cockpit assistant) detects reduced attention and gently guides her attention back to the car and driving context through light conversation and environmental adjustment.

---

## 3. Main Actors

| Actor | Role |
|---|---|
| A | Driver, late-50s female, returning home from shopping |
| AICA(AI cockpit assistant) | In-car AI partner that detects attention decline and proposes gentle recovery actions |

---

## 4. Main Scenario

### Step 1 — Register oshi information

A enters favorite-artist / oshi information through the oshi-katsu app introduced at purchase.

**System / AICA(AI cockpit assistant) action**

- Registers user information.
- Links user profile and oshi information on the server.

### Step 2 — ReadyON after shopping

A gets into the car and turns ReadyON.

**State**

- Emotion: Neutral
- Fatigue: Neutral
- Vehicle: safely stopped at supermarket
- Input data: UserProfile

**System / AICA(AI cockpit assistant) action**

- Retrieves registered user information, such as age, gender, frequently visited places, and oshi information.

### Step 3 — Driving starts

A starts driving from the supermarket.

**State**

- Emotion: Neutral
- Fatigue: Neutral
- Vehicle: immediately after departure from supermarket

### Step 4 — AICA(AI cockpit assistant) detects attention decline and proposes light recovery options

AICA(AI cockpit assistant) says:

> It is your evening return route. It looks like your mind is a little focused on things at home.  
> To bring your attention back to driving, you can lightly choose from these options:  
> 1. Play music that fits this scene  
> 2. Light humming karaoke  
> 3. Talk a little with AI  
> Which would you like? It is sunny today, so opening the window together might feel nice.

**State**

- Emotion: Neutral → anxious/rushed
- Vehicle: immediately after departure / driving

**Input data candidates**

- Time of day
- Departure point and destination
- User concentration state, such as gaze fluctuation or reduced attention
- Personality, age, gender
- Weather

**System / AICA(AI cockpit assistant) action**

- Detects the familiar evening route from supermarket to home.
- Infers that A may be thinking about housework after arriving home.
- Detects reduced concentration and gently suggests a way to bring attention back to the vehicle.
- The AICA(AI cockpit assistant) character/tone may be selected based on personality, age, and gender.

**Candidate options**

- Music recommendation matched to the scene
- Humming karaoke
- Call-and-response practice
- Quiz
- Talking with AI

**Note**

Options other than `talking with AI` are related to the UC-03 monotony/habituation recovery proposal.

### Step 5 — A selects conversation and window opening

A says:

> Then maybe I will talk with you. Also open the window.

AICA(AI cockpit assistant) says:

> Understood. First, I will let in a little outside air.

**State**

- Emotion: anxious/rushed
- Vehicle: driving

**System / AICA(AI cockpit assistant) action**

- Opens the window slightly according to user instruction.
- Lowers BGM volume slightly to make conversation easier.

### Step 6 — AICA(AI cockpit assistant) uses weather and familiar scenery to return attention to the car

AICA(AI cockpit assistant) says:

> The air at this time of day feels a little cool.

A says:

> Yes, it feels nice.

AICA(AI cockpit assistant) says:

> You often take this road after shopping, don't you? How has today been so far?

**State**

- Emotion: anxious/rushed → neutral

**System / AICA(AI cockpit assistant) action**

- Uses weather, scenery, and bodily sensation to gently bring attention back into the cabin and driving context.
- Keeps the question to one item so the user does not overthink.

### Step 7 — AICA(AI cockpit assistant) acknowledges mental load without solving it immediately

A says:

> Shopping is done, but I was thinking there are many things to do when I get home.

AICA(AI cockpit assistant) says:

> That happens around this time of day. It feels like all the things you need to do later come up at once.

A says:

> Yes.

AICA(AI cockpit assistant) says:

> You do not need to organize those thoughts right now. You can think about them properly again after you get home.

**State**

- Emotion: Neutral

**System / AICA(AI cockpit assistant) action**

- Does not try to solve the household-task issue immediately.
- Suggests temporarily putting it aside.

### Step 8 — AICA(AI cockpit assistant) inserts road information to return attention to driving

AICA(AI cockpit assistant) says:

> The outside wind has changed a little. The usual intersection is ahead.

**System / AICA(AI cockpit assistant) action**

- Inserts road information to return awareness to driving.
- If the window is open, makes the driver lightly notice the airflow.

---

## 5. Input Data Candidates

| Category | Data |
|---|---|
| User profile | Age, gender, personality, commonly visited places, oshi information |
| Route context | Departure point, destination, usual route, supermarket-to-home pattern |
| Time and environment | Evening, weather, outside air |
| Driver state | Gaze fluctuation, concentration decline, mental load, attention state |
| Vehicle controls | Window opening, BGM volume |
| Dialogue context | Current user choice, conversation state, number of questions asked |

---

## 6. Candidate Hypotheses

```text
H-ATT-001:
Soft conversational intervention can help recover attention without increasing cognitive burden.

H-ENV-001:
Environmental adjustment such as opening the window or lowering BGM volume can support attention recovery.

H-UX-001:
AICA(AI cockpit assistant) should use gentle and non-commanding language when risk is not urgent.

H-UX-002:
AICA(AI cockpit assistant) should ask only one lightweight question at a time during driving.

H-SAFE-001:
Attention recovery support should avoid complex visual or cognitive interaction while driving.

H-CONTEXT-001:
AICA(AI cockpit assistant) can use route, time, destination, weather, and user-state context to infer that attention is directed away from driving.
```

---

## 7. Requirement Candidate Seeds

```text
REQ-ATT-001:
AICA(AI cockpit assistant) shall detect attention decline using user concentration signals such as gaze fluctuation or equivalent indicators.

REQ-CONTEXT-001:
AICA(AI cockpit assistant) shall consider time of day, departure point, destination, and familiar-route context when generating attention recovery proposals.

REQ-UX-001:
AICA(AI cockpit assistant) shall use gentle, optional wording for non-urgent attention recovery.

REQ-UX-002:
AICA(AI cockpit assistant) shall keep attention recovery questions lightweight and limited to one at a time.

REQ-ENV-001:
AICA(AI cockpit assistant) shall be able to adjust cabin environment, such as opening the window slightly or lowering BGM volume, with user consent.

REQ-SAFE-001:
AICA(AI cockpit assistant) shall avoid complex interactions while the vehicle is moving.

REQ-DIALOGUE-001:
AICA(AI cockpit assistant) shall not force problem-solving during driving when the user's concern is unrelated to immediate driving safety.
```

---

## 8. Validation Artifact Ideas

| Validation Target | Artifact |
|---|---|
| AICA(AI cockpit assistant) tone | Dialogue comparison prototype: gentle vs rational/commanding |
| Cognitive load | Conversation playback with one-question vs multi-question behavior |
| Environmental adjustment | Scenario playback showing window/BGM changes |
| Attention recovery | Timeline showing user attention state before and after AICA(AI cockpit assistant) intervention |
| Safety | Review checklist for conversation complexity while driving |
| Context inference | Data feasibility matrix for gaze, route, time, destination, and weather |

---

## 9. Open Issues

```text
- What signal quality is required to identify attention decline?
- How should AICA(AI cockpit assistant) distinguish normal thinking from risky attention decline?
- How should AICA(AI cockpit assistant) avoid making the driver feel criticized?
- What types of conversation are safe while driving?
- How much environmental control can AICA(AI cockpit assistant) perform automatically?
- Should AICA(AI cockpit assistant) always ask permission before opening the window or changing BGM?
- How should the system select AICA(AI cockpit assistant) tone based on personality, age, or gender?
```
