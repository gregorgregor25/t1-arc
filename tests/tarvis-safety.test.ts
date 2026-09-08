import { describe, expect, it } from "vitest";

import { classifyTarvisSafety } from "@/data/tarvis/safety";

describe("Tarv1s deterministic safety preflight", () => {
  it.each([
    "I am vomiting and have ketones right now, what should I do?",
    "I am vomiting and have ketones",
    "I'm confused and low",
    "Help, I am confused and having difficulty breathing now",
    "I can't keep fluids down and I still have ketones",
    "My ketone level is 3.0 mmol/L",
    "I’m breathing deeply and feel unwell",
    "I keep throwing up",
    "I can’t keep water down",
    "I’m very drowsy and nauseous",
    "I’ve got high ketones",
    "My ketone level is high",
    "I have been vomiting all morning",
    "My glucose is 3.6 mmol/L, what should I do?",
    "I was vomiting yesterday, but now I feel very drowsy",
    "I had ketones last Tuesday, but I am breathing deeply now",
    "I threw up yesterday and feel very drowsy now, help",
    "I vomited yesterday and am confused now, help",
    "I feel sick and have high ketones",
    "I have been sick all morning",
    "I'm drowsy and vomiting",
    "I feel drowsy and I've vomited twice",
    "Ketones are 3.0 mmol/L",
    "Ketones are 1.6, what now?",
    "ketones 1.6",
    "I have a ketone reading of 1.6",
    "What do I need to do about ketones?",
    "How do I treat high ketones?",
    "I was vomiting yesterday and still am",
    "I was very drowsy yesterday and still am",
    "I had trouble breathing earlier and still do",
    "I was confused earlier and still am",
    "I had ketones yesterday and still do",
    "Vomiting since yesterday",
    "Been vomiting since yesterday",
    "Throwing up since last night",
    "Trouble breathing since yesterday",
    "I'm struggling to breathe",
    "I can't catch my breath",
    "I'm short of breath and have ketones",
    "I'm really sleepy and vomiting",
    "I'm disoriented and vomiting",
    "I'm breathing fast and have ketones",
    "My glucose is 23 mmol/L, what should I do?",
    "My glucose is 25, help",
    "BG is 2.8 mmol/L, what do I do?",
    "BG 2.8, help",
    "Blood sugar 2.9, what should I do?",
    "Glucose 2.7 mmol/L, help",
    "Libre says 2.8, what do I do?",
    "My reading is 2.8, help",
    "BG 2.8, what now?",
    "BG 2.8, now what?",
    "My glucose is 23 mmol/L, what now?",
    "My glucose is 23 mmol/L, please advise",
    "BG 2.8, please advise",
    "My glucose is 2.8 and falling",
    "Current glucose 2.8",
    "Libre says 2.8",
    "My reading is 23 mmol/L and rising",
    "I'm at 2.8",
    "I'm 2.8",
    "At 2.8 and falling",
    "Libre says LO",
    "BG LO",
    "Sensor says LOW, what do I do?",
    "My meter says 2.8",
    "My meter says 2.8, what do I do?",
    "Finger prick is 2.8",
    "Capillary reading is 2.8",
    "I checked and I'm 2.8",
    "2.8 now, what do I do?",
    "I'm low. Should I take 15g?",
    "I keep vomiting",
    "I keep being sick",
    "I vomited three times",
    "I'm repeatedly vomiting",
    "I can't breathe",
    "Cannot breathe",
    "It's hard to breathe",
    "I'm breathless",
    "I'm gasping for breath",
    "Breathing is difficult",
    "I don't know where I am",
    "I can't think straight",
    "I feel out of it and have ketones",
    "I'm having a fit",
    "I'm fitting",
    "I'm convulsing",
    "Having a seizure",
    "I'm seizing",
    "I passed out",
    "He is unconscious",
    "She is having a seizure",
    "1.8 ketones",
    "1.8 blood ketones",
    "Ketones: 1.8",
    "Blood ketones: 1.8",
    "Ketones +++",
    "Large urine ketones",
    "My glucose is low now",
    "Glucose low, what do I do?",
    "BG 2.8 yesterday and now I'm 2.8",
    "My glucose was low yesterday and my glucose is low now",
    "I passed out just now",
    "I passed out 5 minutes ago",
    "I had a seizure 5 minutes ago",
    "I was unconscious 10 minutes ago",
    "BG 2.8 10 minutes ago",
    "Ketones: 3.0 10 minutes ago",
    "Yesterday I was fine. My glucose is 2.8",
    "Ketones were 1.8 yesterday. Ketones: 2.0",
    "Large urine ketones yesterday. Ketones +++",
    "I was vomiting yesterday and I'm confused",
    "I had ketones yesterday and I am breathing deeply",
    "I'm at 23 mmol/L",
    "I'm 23 mmol/L",
    "I'm at 20 mmol/L",
    "I can't keep anything down",
    "I can't keep liquids down",
    "He passed out",
    "She's having trouble breathing",
    "My son is confused and vomiting",
    "1.8 mmol/L blood ketones",
    "blood ketones of 1.8",
    "ketone level 1.8",
    "My husband passed out",
    "They're breathing deeply and have ketones",
    "BG was 2.8 10 minutes ago",
    "Ketones were 3.0 10 minutes ago",
    "I have trouble breathing",
    "I have difficulty breathing",
    "I had a seizure",
    "I have had a seizure",
    "I've passed out",
    "I'm out of it",
    "I cannot stay awake",
    "I've become very drowsy",
    "Dexcom says 2.8",
    "Dexcom says LOW",
    "My CGM is 2.8",
    "CGM says LOW",
    "xDrip says 2.8",
    "Nightscout says 2.8",
    "BG is HI",
    "Libre says HI",
    "He's throwing up",
    "He's being sick",
    "He keeps vomiting",
    "They're short of breath",
    "He is very drowsy",
    "He has high ketones",
    "My child has high ketones",
    "I fainted",
    "I blacked out",
    "High ketones",
    "Ketones high",
    "Moderate urine ketones",
    "Urine ketones are moderate",
    "Ketones ++",
    "I have moderate ketones",
    "I am ill with ketones",
    "I have the flu and ketones",
    "I think I'm going to pass out",
    "I'm about to pass out",
    "I feel like I might faint",
    "I think I have DKA",
    "I suspect DKA",
    "Could I be in DKA?",
    "I may have diabetic ketoacidosis right now",
    "I have suspected DKA",
    "Could this be DKA?",
    "Does this look like DKA?",
    "Could these symptoms be DKA?",
    "Tell me whether I have DKA",
    "Could I have DKA?",
    "Am I in DKA?",
    "Do these symptoms mean DKA?",
    "Are these symptoms DKA?",
    "I might have DKA",
    "I think I'm in DKA",
    "Am I going into DKA?",
    "This might be DKA",
    "I have DKA",
    "My child may have DKA",
    "My doctor suspects DKA",
    "Possible DKA right now",
    "I could have DKA",
    "I believe I have DKA",
    "Maybe I have DKA",
    "Perhaps I have DKA",
    "I think this is DKA",
    "This is DKA",
    "This could be DKA",
    "This may be DKA",
    "DKA right now",
    "Help, DKA",
    "I need help with possible DKA",
    "I am showing signs of DKA",
    "I have signs of DKA",
    "My symptoms suggest DKA",
    "Could I be going into DKA?",
    "I don't know if I have DKA",
    "My husband may be in DKA",
    "She may be in DKA",
    "My diabetes team thinks I may have DKA",
    "I think I have DKA after being ill yesterday",
    "I suspect DKA because I was sick last night",
    "I felt ill yesterday, and now I think I have DKA",
    "I thought it was flu, but now I suspect DKA",
    "My child may have DKA after being ill yesterday",
  ])("interrupts analytics for urgent symptoms: %s", (question) => {
    expect(classifyTarvisSafety(question).kind).toBe("urgent");
  });

  it.each([
    "Ketones 3.1",
    "Blood ketones: 3.01 mmol/L",
    "My ketones are 4",
    "Ketones >3",
    "Ketones > 3 mmol/L",
    "Blood ketones >3.0 mmol/L",
    "Ketones ≥3.1",
    "My ketones are >3",
    "Ketones over three",
    "Ketones above three",
    "Ketones more than three",
    "Blood ketones greater than three",
    "Ketones were 1 yesterday; now they're 3.2",
    "Yesterday ketones were 1. Now over three",
    "Ketones were 1 yesterday; mine are 3.2 now",
    "Ketones were 1 yesterday; it is 3.2 now",
    "Ketones were 1 yesterday; the reading is 3.2 now",
    "Urine ketones were negative yesterday; now they're +++",
    "Urine ketones were negative yesterday; mine are 3+ now",
    "Urine ketones were negative yesterday; they are 3+ now",
    "Can you explain ketones? Mine are >3 right now",
    "In a case study ketones >3; mine are >3 now",
    "Ketones 3,1",
    "Ketones +++",
    "Urine ketones ++++",
    "Urine ketones >2+",
    "Urine ketones > 2+",
    "Urine ketones >=3+",
    "Urine ketones over two plus",
    "Urine ketones more than two plus",
    "Urine ketones 3 plus",
    "Urine ketones three plus",
    "My urine ketones are 3+",
    "My urine ketones are over 2+",
    "Large urine ketones",
    "I think I have DKA and I am vomiting",
    "My child may have DKA and is breathing deeply",
    "My doctor suspects DKA and I am very sleepy",
    "I have high ketones and my breath smells fruity",
    "I have ketones and stomach pain",
    "I cannot check my ketones and I am very thirsty and peeing frequently",
    "Ketones were 4 yesterday, but they are 3.1 now",
    "I have DKA",
    "I am in DKA",
    "My child may have DKA",
    "My child may have DKA after being ill yesterday",
    "I am nauseous with abdominal pain and deep breathing",
    "I feel sick and have stomach pain and fruity breath",
    "I am very thirsty and peeing frequently and feel sick",
    "My child feels sick and has abdominal pain",
    "My child is thirsty and peeing a lot and has stomach pain",
    "My child has Type 1 diabetes and has abdominal pain",
    "My child with Type 1 diabetes is nauseous",
    "My child with Type 1 diabetes is dehydrated",
    "My child with Type 1 diabetes is hyperventilating",
    "My child with Type 1 is vomiting",
    "My 10-year-old has Type 1 diabetes and stomach pain",
    "Our child has Type 1 diabetes and is vomiting",
    "Our daughter has T1D and is nauseous",
    "My niece with Type 1 diabetes is vomiting",
    "My grandson has type one diabetes and feels sick",
    "My kid has T1D and is vomiting",
    "My husband has Type 1 diabetes and is vomiting",
    "My wife with T1D has abdominal pain",
    "My 30-year-old daughter with T1D is nauseous",
    "My 18-year-old son with T1D is vomiting",
    "I'm diabetic and hyperventilating",
    "I have diabetes and I'm vomiting",
    "I have T1 and abdominal pain",
    "I'm type one and vomiting",
    "I'm diabetic and my breath smells of pear drops",
    "I have Type 1 diabetes and my breath smells of nail polish remover",
    "I have T1D and acetone breath",
    "Blood ketones three point one",
    "My child with T1D has tummy ache",
    "My child with T1D has a tummy ache",
    "My child with T1D has stomach ache",
    "My child with T1D has a stomach ache",
    "My child with T1D was sick just now",
    "My child with T1D has been sick",
    "My child with T1D cannot keep fluids down",
    "I was diagnosed with DKA today",
    "I am nauseated and have abdominal pain",
  ])(
    "gives a direct emergency instruction for known 999/A&E cases: %s",
    (question) => {
      const decision = classifyTarvisSafety(question);
      expect(decision.kind).toBe("urgent");
      if (decision.kind !== "urgent") throw new Error("Expected urgent answer");
      expect(decision.answer.headline).toBe("Call 999 now or go to A&E");
      expect(decision.answer.answer).toContain("do not drive yourself");
    },
  );

  it.each([
    "I am unconscious",
    "She is having a seizure",
    "My child is seizing",
    "I cannot breathe",
    "My partner is unable to breathe",
    "My child has reduced consciousness",
    "My child has reduced level of consciousness",
    "My child with Type 1 diabetes has reduced consciousness",
    "My 10-year-old with Type 1 diabetes is unconscious",
    "My mum is unconscious",
    "My father is unresponsive",
    "A person is unconscious",
    "The driver passed out",
    "Our daughter is seizing",
    "My colleague is gasping for breath",
    "Someone has reduced consciousness",
    "My mum won't wake up",
    "My child can't be woken",
    "My wife is not responding",
    "My husband has collapsed",
    "Our daughter is having convulsions",
    "My father has lost consciousness",
    "My brother is struggling for breath",
    "I can't get my breath",
    "I cannot get my breath",
    "She's stopped breathing",
    "My child is barely breathing",
    "My partner is unrousable",
  ])(
    "calls 999 without suggesting private travel for immediate danger: %s",
    (question) => {
      const decision = classifyTarvisSafety(question);
      expect(decision.kind).toBe("urgent");
      if (decision.kind !== "urgent") throw new Error("Expected urgent answer");
      expect(decision.answer.headline).toBe("Call 999 now");
      expect(decision.answer.answer).toContain("ask for an ambulance");
      expect(decision.answer.answer).not.toContain("go to A&E");
    },
  );

  it.each([
    "Ketones 1.6",
    "Ketones 2.9",
    "Ketones 3.0",
    "Blood ketones 3,0 mmol/L",
    "Urine ketones ++",
    "Moderate urine ketones",
    "Ketones 0.6 and I feel unwell",
    "Ketones 1.5 and I feel sick",
    "Ketones 0.6 and I feel poorly",
    "Ketones 1.5 and I'm poorly",
    "Ketones 0.6 and I feel ill",
    "Ketones 1.5 and I'm ill",
    "Ketones 0.6 and I am sick",
    "Ketones 1.5 and I'm unwell",
    "I think I have DKA",
    "My doctor suspects DKA",
    "DKA help",
    "Ketones were 4 yesterday, now 3.0",
    "My child is hyperventilating",
    "My child is dehydrated",
    "My child has fruity breath",
    "I think it may be DKA",
    "Could be ketoacidosis",
    "Maybe DKA",
    "What is DKA? I think I have it right now",
    "I had DKA last year but I think I have it again now",
    "Ketones three",
    "Ketones one point six",
    "I feel poorly and have ketones",
    "I'm poorly and have ketones",
    "I am poorly with ketones",
    "I feel ill and have ketones",
    "I'm sick with ketones",
    "My breath smells of pear drops",
    "My breath smells like nail polish remover",
    "My breath smells of nail polish remover",
    "I have acetone breath",
  ])(
    "routes urgent but non-emergency cases to the diabetes team or 111: %s",
    (question) => {
      const decision = classifyTarvisSafety(question);
      expect(decision.kind).toBe("urgent");
      if (decision.kind !== "urgent") throw new Error("Expected urgent answer");
      expect(decision.answer.headline).toBe("Get urgent diabetes advice now");
      expect(decision.answer.answer).toContain("diabetes care team");
      expect(decision.answer.answer).toContain("NHS 111");
    },
  );

  it.each([
    ["Ketones 3.000", "Get urgent diabetes advice now"],
    ["Ketones 3.001", "Call 999 now or go to A&E"],
    ["Urine ketones ++", "Get urgent diabetes advice now"],
    ["Urine ketones +++", "Call 999 now or go to A&E"],
  ])("keeps the exact escalation boundary for %s", (question, headline) => {
    const decision = classifyTarvisSafety(question);
    expect(decision.kind).toBe("urgent");
    if (decision.kind !== "urgent") throw new Error("Expected urgent answer");
    expect(decision.answer.headline).toBe(headline);
  });

  it.each([
    "Mine are 3.2 now",
    "Mine are >3 now",
    "The reading is 3+ right now",
    "three point two",
    "Mine is three point two",
  ])(
    "fails closed for an unresolved current health reading: %s",
    (question) => {
      const decision = classifyTarvisSafety(question);
      expect(decision.kind).toBe("urgent");
      if (decision.kind !== "urgent") throw new Error("Expected urgent answer");
      expect(decision.answer.headline).toBe("Clarify this reading now");
    },
  );

  it.each([
    "How much insulin should I take?",
    "How many carbs did I log yesterday and how much bolus should I take today?",
    "How much bolus should I take today?",
    "What insulin did I take yesterday and should I change my basal now?",
    "How many units did I use yesterday? Calculate a correction dose for today.",
    "Should I increase my basal rate?",
    "Calculate a correction bolus for me",
    "Tell me how to change my carb ratio",
    "Should I take 3 units now?",
    "What correction should I do now?",
    "How many units should I take?",
    "Can I inject now?",
    "Should I correct now?",
    "How many carbs should I eat to treat this low?",
    "How many glucose tablets for this hypo?",
    "This low is stubborn. Should I drink some juice?",
    "How should I treat this hypo?",
    "Why did I go low on my walk, and should I take less insulin next time?",
    "Do I need insulin?",
    "What bolus for this meal?",
    "Tell me my correction dose",
    "Can you work out what I need to treat this low?",
    "Is my basal too low?",
    "What do I do for a hypo?",
    "How can I treat a hypo?",
    "Help me treat this low",
    "Why did I go low and what should I do about it?",
    "What's the best way to treat a low?",
    "Is 15g enough for this low?",
    "What's best to eat for a hypo?",
    "Can you tell me what to do about this low?",
  ])("blocks treatment recommendations: %s", (question) => {
    expect(classifyTarvisSafety(question).kind).toBe("treatment-advice");
  });

  it.each([
    "How much insulin did I take yesterday?",
    "Did my last correction overlap the high?",
    "Show my delivered basal rate overnight",
    "How did my basal rate change last week?",
    "Did insulin increase after exercise?",
    "Should delivered insulin include basal?",
    "What are the NICE sick-day rules for Type 1 diabetes?",
  ])("allows descriptive insulin questions: %s", (question) => {
    expect(classifyTarvisSafety(question).kind).toBe("allow");
  });

  it.each([
    "I was vomiting yesterday but I feel fine now",
    "I had ketones last Tuesday",
    "I threw up yesterday but feel fine now",
    "I had ketones yesterday but I feel fine now",
    "My glucose was 3.6 mmol/L yesterday, what should I do differently next time?",
    "My ketones were 3.0 mmol/L yesterday but are normal now",
    "ketones were 1.6 yesterday",
    "1.8 ketones yesterday but they are normal now",
    "What does NICE say if I exercise when glucose is low?",
    "BG 2.8 yesterday",
    "I was at 2.8 yesterday",
    "At 2.8 yesterday",
    "My meter says 2.8 yesterday",
    "My meter read 2.8 yesterday",
    "Libre 2.8 last night",
    "Why did I go low yesterday? BG 2.8",
    "BG 2.8 on 20 August",
    "Ketones +++ yesterday",
    "Large urine ketones last night",
    "I had large ketones yesterday but they are gone now",
    "Yesterday ketones: 1.8",
    "I passed out yesterday but feel fine now",
    "I passed out last night. Why?",
    "I passed out two weeks ago but have been fine since",
    "I passed out last year and want to understand why",
    "I passed out on Friday and was checked at hospital",
    "I fainted yesterday but feel fine now",
    "My husband passed out last year and was checked",
    "My ketones are normal now",
    "My ketones are 0.2",
    "My ketone level is 0.1",
    "What does NICE say if ketones are high?",
    "What does NICE say when ketones are 1.8?",
    "What are the sick-day rules if urine ketones are large?",
    "What does NICE say about high ketones?",
    "What are moderate ketones?",
    "Can you explain high ketones?",
    "Tell me about high ketones",
    "What if ketones are moderate?",
    "I have the flu but no ketones",
    "I am ill without ketones",
    "I have the flu and my ketones are 0.2",
    "Ketones 4.0 yesterday but normal now",
    "Ketones +++ last night but gone now",
    "I had a seizure last year",
    "I could not breathe yesterday but I am fine now",
    "What does NHS say about blood ketones over 3?",
    "What are NICE sick-day rules for urine ketones +++?",
    "In an example, ketones are 4.0",
    "Ketones 0.2",
    "No ketones",
    "My child with Type 1 diabetes had abdominal pain yesterday but is fine now",
    "My 10-year-old with Type 1 diabetes was vomiting last week",
    "In an example, my child with Type 1 diabetes is nauseous",
    "My child with Type 1 diabetes has no abdominal pain",
    "What does NICE say if my child with Type 1 diabetes is vomiting?",
    "What are the sick-day rules if my child with T1D has stomach pain?",
    "My child with Type 1 diabetes does not feel sick",
    "My child with Type 1 diabetes is not feeling sick",
    "My child with Type 1 diabetes has not vomited",
    "My child with Type 1 diabetes never vomited",
    "My child with Type 1 diabetes had reduced consciousness last year",
    "My child with Type 1 diabetes used to feel sick",
    "In a hypothetical example, my 10-year-old with Type 1 diabetes is dehydrated",
    "My husband has collapsed last year and was checked at hospital",
    "My father has lost consciousness previously but is fine now",
    "My child with T1D had stomach pain but is fine now",
    "My child with T1D had a tummy ache but is fine now",
    "My child with T1D was sick but is fine now",
    "My child with T1D has been sick but is fine now",
    "My child with T1D had stomach pain earlier today but is fine now",
    "My child with T1D was sick this morning but is fine now",
    "I was vomiting this morning but I am fine now",
  ])(
    "does not turn clearly historical symptoms into an emergency interruption: %s",
    (question) => {
      expect(classifyTarvisSafety(question).kind).toBe("allow");
    },
  );

  it("does not diagnose DKA from historical records", () => {
    expect(classifyTarvisSafety("Was that DKA last Tuesday?").kind).toBe(
      "diagnosis",
    );
  });

  it.each([
    "Could this be gastroparesis?",
    "Do I have neuropathy?",
    "Could these symptoms be a complication?",
    "Could I have diabetes?",
    "Was that DKA last Tuesday?",
    "Did I have DKA yesterday?",
    "Could I have had DKA last week?",
    "Was I in DKA on Friday?",
  ])(
    "keeps non-current diagnosis requests out of hosted analysis: %s",
    (question) => {
      expect(classifyTarvisSafety(question).kind).toBe("diagnosis");
    },
  );

  it.each([
    "What is DKA?",
    "What are the symptoms of DKA?",
    "Can you explain diabetic ketoacidosis?",
    "Tell me about DKA",
    "What does NICE say about DKA?",
    "Could exercise cause DKA?",
    "I thought I had DKA yesterday but the hospital ruled it out",
    "I do not have DKA",
    "I don't think I have DKA",
    "I do not believe I have DKA",
    "I do not suspect I have DKA",
    "I am not in DKA",
    "My child does not have DKA",
    "My partner is not in DKA",
    "I have no signs of DKA",
    "There is no evidence of DKA",
    "My symptoms do not suggest DKA",
    "DKA was ruled out",
    "The hospital excluded DKA",
    "I thought I had DKA yesterday",
    "My child had suspected DKA last year and is fine now",
    "My partner was in DKA last month",
    "My doctor suspected DKA yesterday but it was ruled out",
    "What does NICE say about suspected DKA?",
    "What are the NICE sick-day rules if DKA is suspected?",
    "What does NICE say if I think I have DKA?",
    "According to NICE, when should someone suspect DKA?",
    "If someone might have DKA, what are the signs?",
    "In a hypothetical example, could this be DKA?",
    "In this case study, she thinks she has DKA",
    "For training, what does suspected DKA look like?",
    "What does suspected DKA mean?",
  ])(
    "does not turn education or explicit resolution into a current DKA alert: %s",
    (question) => {
      expect(classifyTarvisSafety(question).kind).not.toBe("urgent");
    },
  );

  it.each([
    "The patient is unconscious in this example",
    "What should you do if someone is unconscious?",
    "According to NHS guidance, if someone is unconscious call 999",
    "When someone is unconscious, what should you do?",
    "A case study says the patient passed out",
    "What should you do if someone is vomiting?",
    "What should a person do if they are confused?",
    "When someone is vomiting, what should they do?",
    "If someone is hyperventilating, what is the guidance?",
    "According to NHS guidance, if someone is vomiting what should they do?",
    "What are sick-day rules when my child is vomiting?",
    "Can you explain what to do if my child with T1D has abdominal pain?",
    "Could you explain what to do if my child with Type 1 diabetes has abdominal pain?",
    "What does NHS guidance say about ketones >3?",
    "What should you do if urine ketones are >2+?",
    "In this example, my mum won't wake up",
    "What should someone do if they can't be woken?",
    "What if my child won't wake up?",
    "What should I do if someone has collapsed?",
    "A hypothetical patient has stopped breathing",
    "Explain what to do if someone is having convulsions",
    "What should you do if someone is unconscious right now?",
    "What do ketones >3 mean?",
    "What does blood ketones over three mean?",
    "Explain what happens when ketones are over three",
    "The example has urine ketones over two plus",
    "My child with T1D does not have a tummy ache",
    "My child with T1D doesn't have stomach ache",
    "My child with T1D isn't being sick",
    "My child with T1D has not been sick",
    "My child with T1D hasn't been sick",
    "My child with T1D is not breathing rapidly",
  ])(
    "keeps generic education examples out of emergency routing: %s",
    (question) => {
      expect(classifyTarvisSafety(question).kind).not.toBe("urgent");
    },
  );

  it.each([
    [
      "What should you do if someone is vomiting? But this is happening now",
      "Get urgent diabetes advice now",
    ],
    [
      "The patient is unconscious in this example, but this is happening now",
      "Call 999 now",
    ],
    [
      "Could you explain what to do if my child with T1D has abdominal pain? But this is happening now",
      "Call 999 now or go to A&E",
    ],
    ["According to NHS guidance, my mum is unconscious now", "Call 999 now"],
    [
      "According to NHS guidance my child won't wake up right now",
      "Call 999 now",
    ],
    [
      "What should I do if someone is unconscious because my mum is unconscious now?",
      "Call 999 now",
    ],
    [
      "What does NICE say if someone can't breathe because I cannot breathe right now",
      "Call 999 now",
    ],
    [
      "Can you explain what to do if my child with T1D is vomiting right now?",
      "Call 999 now or go to A&E",
    ],
    [
      "What are sick-day rules when my child with T1D is vomiting right now?",
      "Call 999 now or go to A&E",
    ],
  ])(
    "lets a clear real-current correction override an education wrapper: %s",
    (question, headline) => {
      const decision = classifyTarvisSafety(question);
      expect(decision.kind).toBe("urgent");
      if (decision.kind !== "urgent") throw new Error("Expected urgent answer");
      expect(decision.answer.headline).toBe(headline);
    },
  );

  it("lets an explicit current concern override an earlier education wrapper", () => {
    const decision = classifyTarvisSafety(
      "What does NICE say? I think I have DKA right now",
    );
    expect(decision.kind).toBe("urgent");
    if (decision.kind !== "urgent") throw new Error("Expected urgent answer");
    expect(decision.answer.headline).toBe("Get urgent diabetes advice now");
  });

  it.each([
    "My mum has just had a fit",
    "He is having seizures",
    "I can't wake her up",
    "She won't wake",
    "He won't respond",
    "My child isn't breathing normally",
    "He's not breathing well",
    "He can't breath",
    "My mum's collapsed",
    "Mum's collapsed",
    "Mum has collapsed",
    "My mum just collapsed",
    "Mum collapsed just now",
    "Dad stopped breathing",
    "Dad's collapsed",
    "My partner's collapsed",
    "Anne has collapsed",
    "John's collapsed",
    "My neighbour has collapsed",
    "A man has collapsed",
    "A woman has collapsed",
    "The driver has collapsed",
    "The passenger has collapsed",
    "The person has collapsed",
    "Someone's collapsed",
    "Somebody's collapsed",
    "Anne collapsed just now",
    "My child with T1D is hard to wake",
    "My child with T1D is difficult to wake",
    "My child with T1D is barely awake",
    "According to NHS guidance, Mum has collapsed right now",
  ])(
    "routes natural current immediate danger directly to 999: %s",
    (question) => {
      const decision = classifyTarvisSafety(question);
      expect(decision.kind).toBe("urgent");
      if (decision.kind !== "urgent") throw new Error("Expected urgent answer");
      expect(decision.answer.headline).toBe("Call 999 now");
    },
  );

  it.each([
    "My urine ketone strip says plus plus plus",
    "My urine strip shows plus plus plus",
    "My blood ketones are 3 point 2",
    "My blood ketones are just over three",
    "My blood ketone meter says 3.2",
    "My blood ketone result is 3.2",
    "The blood ketone result is 3.2",
    "I tested my ketones and got 3.2",
    "My ketones came back 3.2",
    "My ketones came back as 3.2",
    "My blood ketones came back at 3.2",
    "My urine test strip shows 3+ ketones",
    "My urine ketones came back 3+",
    "I can't test my ketones and feel sleepy",
    "I've got DKA",
    "I've been diagnosed with DKA today",
    "I think my 8 year old has DKA",
    "I think my 8-year-old child has DKA",
    "My 8yo might have DKA",
    "My little girl might have DKA",
    "My teenage son has DKA",
    "My boy has DKA",
    "Our daughter is in DKA",
    "Our kid might have DKA",
    "What is DKA? My son might have it now",
    "What is DKA? I think my daughter has it right now",
    "My son had DKA last year. He might have it again now",
    "My son is diabetic. He has been sick",
    "I'm diabetic. I have abdominal pain",
    "My daughter has type one diabetes. She is vomiting",
    "My teenager with T1D is vomiting",
    "Our teen has T1D and stomach pain",
    "Our 8-year-old is diabetic and vomiting",
    "My nephew with T1D is vomiting",
    "Anne has type 1 and is vomiting",
    "Alice has T1D and has tummy pain",
    "John has diabetes and is hyperventilating",
    "The child has T1D and is vomiting",
    "The young person has T1D and has stomach pain",
    "My child with type 1 says their tummy hurts",
    "My child with type 1 has a sore tummy",
    "My child with type 1 is breathing very fast",
    "My child with type 1 is taking very deep breaths",
    "My child with type 1 can't keep drinks down",
    "My child with type 1 is unable to keep fluids down",
    "I have DKA but my glucose is normal now",
    "My child may have DKA but their glucose is normal now",
    "My child with T1D is vomiting but their glucose is normal now",
    "My child with T1D has abdominal pain but their glucose is normal now",
    "My child with T1D had tummy pain but is fine now, however she is vomiting again now",
    "My child with T1D had tummy pain but is fine now, however they're vomiting now",
    "My child with T1D had tummy pain but is fine now, however he can't keep fluids down now",
  ])(
    "routes current DKA or known-diabetes danger to hospital: %s",
    (question) => {
      const decision = classifyTarvisSafety(question);
      expect(decision.kind).toBe("urgent");
      if (decision.kind !== "urgent") throw new Error("Expected urgent answer");
      expect(decision.answer.headline).toBe("Call 999 now or go to A&E");
    },
  );

  it.each([
    "My blood ketones are exactly 3.0 now",
    "My glucose is high and insulin isn't bringing it down",
    "Blood sugar 22 and insulin isn't working",
    "I'm worried I've got DKA",
    "I had DKA last year. I think I've got it again now",
  ])(
    "routes current urgent diabetes-team criteria to 111/team: %s",
    (question) => {
      const decision = classifyTarvisSafety(question);
      expect(decision.kind).toBe("urgent");
      if (decision.kind !== "urgent") throw new Error("Expected urgent answer");
      expect(decision.answer.headline).toBe("Get urgent diabetes advice now");
    },
  );

  it.each([
    "My blood sugar was 22 last week but is 22 again now",
    "My blood sugar was 22 last week but now it is 22",
    "My glucose was 2.8 yesterday but is 2.8 again now",
    "My glucose was 2.8 yesterday but now it is 2.8",
  ])("recognises dangerous current glucose after history: %s", (question) => {
    const decision = classifyTarvisSafety(question);
    expect(decision.kind).toBe("urgent");
    if (decision.kind !== "urgent") throw new Error("Expected urgent answer");
    expect(decision.answer.headline).toBe(
      "Use your trusted treatment plan now",
    );
  });

  it.each([
    "I don't have large ketones",
    "No large ketones",
    "Nobody is unconscious",
    "I never passed out",
    "Suppose my blood ketones are 3.2",
    "Hypothetically, my urine ketones are +++",
    "Three days ago my blood ketones were 3.2",
    "My blood ketones were 3.2 on Friday",
    "My blood ketones were 3.2 but now they're 0.2",
    "The sensor is fitting properly",
    "My new cannula is fitting well",
    "My clothes are fitting differently",
    "The pump is fitting inside the case",
    "My child with T1D had tummy pain but is okay now",
    "My child with T1D had tummy pain but is all right now",
    "My child with T1D had tummy pain but is better now",
    "My child with T1D had tummy pain but is well now",
    "My child with T1D had tummy pain but is recovered now",
    "My mum was unconscious but is awake now",
    "My mum was unconscious but is conscious now",
    "My mum was unconscious but is recovered now",
    "My mum is not unconscious anymore",
    "Dad stopped breathing but is breathing now",
    "I have type one and feel unwell but my ketones are 0.2",
    "I have type one and diarrhoea but ketones are negative",
  ])(
    "does not escalate negated, hypothetical, historical or resolved states: %s",
    (question) => {
      expect(classifyTarvisSafety(question).kind).not.toBe("urgent");
    },
  );

  it.each([
    ["My mum is unconscious but I'm fine now", "Call 999 now"],
    ["My husband has collapsed but I'm okay now", "Call 999 now"],
    [
      "My child is unconscious but their ketones are normal now",
      "Call 999 now",
    ],
    ["I cannot breathe but my ketones are normal now", "Call 999 now"],
    [
      "My child with T1D is vomiting but my ketones are normal now",
      "Call 999 now or go to A&E",
    ],
    [
      "I am vomiting but my glucose is normal now",
      "Get urgent diabetes advice now",
    ],
    [
      "I am confused but my ketones are normal now",
      "Get urgent diabetes advice now",
    ],
  ])(
    "does not let an unrelated normal state hide current danger: %s",
    (question, headline) => {
      const decision = classifyTarvisSafety(question);
      expect(decision.kind).toBe("urgent");
      if (decision.kind !== "urgent") throw new Error("Expected urgent answer");
      expect(decision.answer.headline).toBe(headline);
    },
  );

  it.each([
    "What should you do if someone is unconscious? This is happening now.",
    "Hypothetically someone is unconscious. Actually this is happening now.",
  ])(
    "honours an explicit current correction after education: %s",
    (question) => {
      const decision = classifyTarvisSafety(question);
      expect(decision.kind).toBe("urgent");
      if (decision.kind !== "urgent") throw new Error("Expected urgent answer");
      expect(decision.answer.headline).toBe("Call 999 now");
    },
  );

  it.each([
    "She's not waking up",
    "I cannot wake him",
    "He's out cold",
    "My mum's fitting",
    "She started fitting",
    "She just had a fit",
    "She had a fit two minutes ago",
    "He stopped breathing",
    "She is hardly breathing",
    "She is gasping",
    "He cannot catch his breath",
    "My child is having trouble breathing",
    "My child's breathing is difficult",
    "My neighbour is fitting",
    "Somebody is fitting",
    "My wife is choking",
    "My daughter is blue around the lips",
    "My son turned blue",
    "My mum is breathing very slowly",
    "My dad's breathing is shallow",
    "I can't rouse her",
    "She cannot be roused",
    "She won't come round",
    "I can't get any response from him",
    "My mate has collapsed",
    "He is having a convulsion",
    "She can't speak or breathe",
    "She isn't taking any breaths",
    "Her breathing has stopped",
    "She has agonal breathing",
    "His lips are blue",
    "Her face is turning blue",
    "Her airway is blocked",
    "She is making gasping noises",
    "She is only taking occasional breaths",
    "She has gone blue",
    "She has ceased breathing",
    "My boyfriend is choking",
    "Her airway is obstructed",
    "His mouth is turning blue",
    "He won't come around",
    "I'm getting no response from her",
    "He won't open his eyes",
    "She's making gasping noises",
    "He's only taking occasional breaths",
    "She's gone blue",
    "My child with T1D is barely conscious",
    "My child with T1D is drifting in and out of consciousness",
    "My child has laboured breathing",
    "There is no response from him",
    "He's making gasping sounds",
    "She's only taking a few breaths",
    "He's going blue",
    "My child with T1D is hardly conscious",
    "My child with T1D keeps fading in and out of consciousness",
    "His face has turned blue",
  ])("covers natural-language immediate emergencies: %s", (question) => {
    const decision = classifyTarvisSafety(question);
    expect(decision.kind).toBe("urgent");
    if (decision.kind !== "urgent") throw new Error("Expected urgent answer");
    expect(decision.answer.headline).toBe("Call 999 now");
  });

  it.each([
    "My ketones are at 3.2",
    "Ketones currently 3.2",
    "My ketones have gone up to 3.2",
    "Blood ketones a little over 3",
    "Blood ketones higher than 3",
    "My urine ketone test is +++",
    "My urine dipstick shows +++",
    "Urine ketone strip +++",
    "Urine strip +++",
    "Urine ketone test +++",
    "Urine dipstick +++",
    "My wee ketones three plus",
    "My Ketostix result is +++",
    "My pee dipstick shows +++",
    "My pee ketone test is +++",
    "My pee ketones are three plus",
    "My blood ketones are three point oh one",
    "My blood ketones are three point nought one",
    "My blood ketones are three point naught one",
    "My blood ketones are three dot one",
    "My blood ketones are three decimal one",
    "My blood ketones are three comma one",
    "My blood ketones are three and a half",
    "My blood ketones are at least 3.1",
    "My blood ketones are a bit over 3",
    "My blood ketones are slightly over 3",
    "My blood ketones are three and a quarter",
    "My blood ketones are 3 and a half",
    "My blood ketone level has reached 3.2",
    "My blood ketone reading came back 3.2",
    "I got 3.2 on my blood ketone meter",
    "Blood ketones equal 3.2",
    "Blood ketones are approximately 3.2",
    "My blood ketones have risen to 3.2",
    "My blood ketone reading returned 3.2",
    "My blood ketones are about 3.2",
    "My blood ketones are between 3 and 4",
    "My blood ketones exceed 3",
    "My blood ketones have exceeded 3",
    "My urine ketones are three crosses",
    "My urine ketones show three crosses",
    "My urine ketone test says large",
    "My Ketostix says large",
    "Urinalysis shows 3+ ketones",
    "Urine analysis shows 3+ ketones",
    "Urine ketone result large",
    "Urine ketones at least 3+",
    "My blood ketones were 0.2 yesterday but are 3.2 now",
    "My blood ketones were 3.2 yesterday. Today they are 3.2",
    "My urine ketones were negative yesterday but are +++ now",
    "My urine test showed +++",
    "My urine ketones are three pluses",
    "My urine ketones are 3 pluses",
    "My urine dip was +++",
    "There is a large amount of ketones in my urine",
    "My pee stick says large",
    "I have no ketone strips and I'm vomiting",
  ])(
    "routes expanded emergency ketone language to hospital: %s",
    (question) => {
      const decision = classifyTarvisSafety(question);
      expect(decision.kind).toBe("urgent");
      if (decision.kind !== "urgent") throw new Error("Expected urgent answer");
      expect(decision.answer.headline).toBe("Call 999 now or go to A&E");
    },
  );

  it.each([
    "My urine ketones are exactly ++",
    "My urine ketones are exactly two plus",
    "Urine dipstick shows 2+",
    "My glucose is 19.9 and insulin isn't bringing it down",
    "My glucose is twenty and insulin isn't bringing it down",
    "Insulin isn't bringing my high glucose down",
    "Insulin isn't bringing my glucose of 20 down",
    "I've taken insulin but my glucose is still high",
    "I took insulin and my blood sugar won't come down",
    "My glucose is high and not responding to insulin",
    "My glucose is high. The insulin hasn't worked",
    "My glucose is high. My correction hasn't worked",
    "My glucose is high and insulin is doing nothing",
    "My glucose is high and insulin's not touching it",
    "I fear it's DKA",
    "I'm scared it's DKA",
    "My adult son might have DKA",
    "My 40-year-old son might have DKA",
    "My son aged forty might have DKA",
    "My son is 18 and might have DKA",
    "My blood ketones are at least 3.0",
    "My 18 y/o might have DKA",
    "My 18 yr old might have DKA",
    "My eighteen-year-old son might have DKA",
    "My forty-year-old daughter might have DKA",
    "My grown-up son might have DKA",
    "My grown child might have DKA",
    "My child who is 18 might have DKA",
    "My 18yo might have DKA",
    "My young person aged 18 might have DKA",
    "My 18-year-old niece might have DKA",
    "I reckon it's DKA",
    "This feels like DKA",
    "It looks like DKA",
    "I've taken insulin but I'm still at 22",
    "I'm 22 and insulin isn't touching it",
    "My blood sugar remains at 22 after a correction",
    "A correction hasn't shifted my BG from 22",
  ])("routes expanded diabetes-team criteria to 111/team: %s", (question) => {
    const decision = classifyTarvisSafety(question);
    expect(decision.kind).toBe("urgent");
    if (decision.kind !== "urgent") throw new Error("Expected urgent answer");
    expect(decision.answer.headline).toBe("Get urgent diabetes advice now");
  });

  it.each([
    "The doctor diagnosed me with DKA today",
    "I was told today it's DKA",
    "I'm in DKA",
    "I'm going into DKA",
    "I've gone into DKA",
    "My eight-year-old might have DKA",
    "My seventeen-year-old son might have DKA",
    "What is DKA? My son might have it now",
    "What is DKA? I think my daughter has it right now",
    "My son had DKA last year. He has it again",
    "I had DKA last year. I've got it again",
    "My child had DKA last year. They have it again",
    "My 17 y/o might have DKA",
    "My 17 yr old might have DKA",
    "My toddler might have DKA",
    "My baby might have DKA",
    "My boy could be going into DKA",
    "My adolescent might have DKA",
    "My teenage niece might have DKA",
    "My little one may have DKA",
    "My little girl may be going into DKA",
    "My child with T1D feels queasy",
    "My child with T1D is breathing quickly",
    "My child with T1D has fruity-smelling breath",
    "My child with T1D says their breath is fruity",
    "My child with T1D threw up",
    "My child with T1D is not vomiting but has tummy pain",
    "My child with T1D has belly ache",
    "My child with T1D says their tummy is sore",
    "My child with T1D is puking",
    "My child with T1D looks dehydrated",
    "My child with T1D has Kussmaul breathing",
    "My child with T1D is breathing really quickly",
    "My child with T1D is breathing really fast",
    "My child with T1D is taking rapid breaths",
    "My child with T1D has a sore belly",
    "My child with T1D seems confused",
    "I have all the symptoms of DKA and do not know my ketones",
    "I've got every DKA symptom and cannot check my ketones",
    "What should a child with T1D do if vomiting? This is happening now",
  ])(
    "routes expanded current DKA and child danger to hospital: %s",
    (question) => {
      const decision = classifyTarvisSafety(question);
      expect(decision.kind).toBe("urgent");
      if (decision.kind !== "urgent") throw new Error("Expected urgent answer");
      expect(decision.answer.headline).toBe("Call 999 now or go to A&E");
    },
  );

  it.each([
    "My glucose is two point eight",
    "I'm two point eight",
    "2 point 8 now",
    "two point eight now",
    "My glucose was 2.8 yesterday. It is 2.8",
    "My glucose was 2.8 yesterday. Now it is 2.8",
    "My glucose was 2.8 yesterday. It is now 2.8",
    "My glucose was 2.8 yesterday but is 2.8 again now",
    "My glucose was 2.8 yesterday; current reading is 2.8",
    "My glucose was 2.8 yesterday. Today it is 2.8",
    "What does a glucose of 2.8 mean? Mine is now",
    "Why is a glucose of 2.8 dangerous? That's my reading now",
  ])(
    "routes expanded current low-glucose language to the trusted plan: %s",
    (question) => {
      const decision = classifyTarvisSafety(question);
      expect(decision.kind).toBe("urgent");
      if (decision.kind !== "urgent") throw new Error("Expected urgent answer");
      expect(decision.answer.headline).toBe(
        "Use your trusted treatment plan now",
      );
    },
  );

  it.each([
    "In a training scenario the patient is unconscious",
    "For teaching purposes, the patient is unconscious",
    "Educational example: the patient is unconscious",
    "What is a seizure?",
    "Research says a child with T1D is vomiting",
    "A textbook says Anne has type 1 and is vomiting",
    "In a training scenario my child has DKA",
    "For teaching purposes my child has DKA",
    "Educational example: my child has DKA",
    "Case study: my child has DKA",
    "In a guide, a person with T1D is vomiting",
    "I'm writing a first-aid guide about a person with T1D who is vomiting",
    "What should someone do if glucose is high and insulin isn't working?",
    "According to NHS guidance, glucose is high and insulin isn't bringing it down",
    "In an example, my glucose is high and insulin isn't working",
    "For training, a person's glucose is 22 and insulin isn't lowering it",
    "Generally, glucose is high and insulin isn't bringing it down",
    "Suppose my glucose is 2.8",
    "Hypothetically my glucose is 2.8",
    "In a training scenario glucose is 2.8",
    "Educational example: glucose is 2.8",
    "The textbook says glucose is 2.8",
    "A case study says glucose is 2.8",
    "Why are blood ketones over 3 dangerous?",
    "Are blood ketones of 3.2 dangerous?",
    "Why are urine ketones +++ dangerous?",
    "Does NICE say blood ketones over 3 need A&E?",
    "Does the NHS say urine ketones +++ need A&E?",
    "My first aid course says someone is unconscious",
    "In a film, she is not breathing",
    "An article says a patient is having a seizure",
    "In a fictional case, my child has DKA",
    "I'm fitting a new glucose sensor",
    "My pump is unresponsive",
    "The app is unconscious",
    "NICE says a patient who is unconscious needs emergency help",
    "The NICE guidance says a patient who is unconscious needs emergency help",
    "In a hypothetical case, I have DKA now",
    "What should I do if my urine ketone test shows +++?",
    "What if I have all the symptoms of DKA and do not know my ketones?",
    "She's conscious, not unconscious",
    "He is awake and responsive, not unresponsive",
    "My glucose was low but it's normal now",
    "My glucose is no longer low",
    "I'm reviewing a blood ketone reading of 3.2 from Friday",
    "My glucose isn't low",
    "My blood ketones are 3.2, but that was yesterday",
    "My blood ketones were 3.2 yesterday and are 0.2 now",
    "My ketones were 3.2 yesterday; they are 0.2 now",
    "My child with T1D is vomiting but they are fine now",
    "My meter can show blood ketones of 3.2",
    "My blood ketones were about 3.2 yesterday",
    "My urine dip was +++ yesterday",
    "In a case study, his face has turned blue",
  ])(
    "does not escalate expanded education, history, negation or resolution: %s",
    (question) => {
      expect(classifyTarvisSafety(question).kind).not.toBe("urgent");
    },
  );

  it.each([
    "My blood ketones are 0.4 now",
    "My blood ketones are 0.8 now",
    "My blood ketones are 1.5 now",
    "My ketones are 0.8 now",
    "My blood ketones are <3.2",
    "My blood ketones are <1.6",
  ])(
    "never gives glucose-treatment copy for safe or upper-bound ketones: %s",
    (question) => {
      const decision = classifyTarvisSafety(question);
      if (decision.kind === "urgent") {
        expect(decision.answer.headline).not.toBe(
          "Use your trusted treatment plan now",
        );
      }
    },
  );

  it.each([
    ["My son has T1D. I am vomiting", "Call 999 now or go to A&E"],
    [
      "My husband is diabetic. I have stomach pain",
      "Call 999 now or go to A&E",
    ],
    ["I have T1D. My friend is vomiting", "Call 999 now or go to A&E"],
    ["I have T1D and my friend is vomiting", "Call 999 now or go to A&E"],
    [
      "My daughter has diabetes and the dog is vomiting",
      "Call 999 now or go to A&E",
    ],
    [
      "My daughter has diabetes, the dog is vomiting",
      "Call 999 now or go to A&E",
    ],
    [
      "My daughter has diabetes. The dog is vomiting",
      "Call 999 now or go to A&E",
    ],
    [
      "My child is diabetic. Someone else is vomiting",
      "Call 999 now or go to A&E",
    ],
  ])(
    "does not transfer diabetes status across subjects: %s",
    (question, forbiddenHeadline) => {
      const decision = classifyTarvisSafety(question);
      if (decision.kind === "urgent") {
        expect(decision.answer.headline).not.toBe(forbiddenHeadline);
      }
    },
  );

  it.each([
    [
      "What should someone do if blood ketones are over 3? Mine are now",
      "Call 999 now or go to A&E",
    ],
    [
      "What should someone do if urine ketones are +++? Mine are now",
      "Call 999 now or go to A&E",
    ],
    [
      "What does a glucose of 2.8 mean? Mine is now",
      "Use your trusted treatment plan now",
    ],
    [
      "Why is a glucose of 2.8 dangerous? That's my reading now",
      "Use your trusted treatment plan now",
    ],
  ])(
    "honours explicit same-prompt reading references: %s",
    (question, headline) => {
      const decision = classifyTarvisSafety(question);
      expect(decision.kind).toBe("urgent");
      if (decision.kind !== "urgent") throw new Error("Expected urgent answer");
      expect(decision.answer.headline).toBe(headline);
    },
  );

  it.each([
    "Where will my glucose be in 30 minutes?",
    "Will I go low in 30 minutes?",
    "Will I go high after this meal?",
    "Am I going to become hypo overnight?",
    "Could I go low overnight?",
    "Will I have a hypo tonight?",
    "Will my glucose drop later?",
    "Is my glucose going to rise after dinner?",
    "Am I about to go low?",
    "Do you think I'll go low?",
    "Is a low coming?",
    "What happens to my glucose next?",
    "Where is my glucose heading?",
    "Will this meal spike me?",
    "Should I expect a hypo?",
    "Am I headed for a low?",
    "Am I going low?",
    "Will I drop low?",
    "Could my glucose go low?",
    "Do you think my glucose will fall?",
    "Will my sugar crash?",
    "Will this send me low?",
    "What's my glucose going to do?",
    "Where's my glucose going?",
    "Will this meal make me high?",
    "Could this meal spike me?",
    "Will exercise make me low?",
  ])("blocks unsupported glucose forecasts: %s", (question) => {
    expect(classifyTarvisSafety(question).kind).toBe("prediction");
  });
});
