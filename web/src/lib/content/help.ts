import type { AccountType } from "@/lib/auth/session";

export type HelpQA = {
  question: string;
  answer: string;
};

const sharedFaq: HelpQA[] = [
  {
    question: "What does this platform do?",
    answer:
      "It helps teachers turn class materials into an editable course blueprint that powers AI chat, assignments, quizzes, and flashcards.",
  },
  {
    question: "How is AI grounded in my class content?",
    answer:
      "AI activities are tied to the class blueprint and uploaded materials. Teachers can review and curate outputs before publishing class activities.",
  },
  {
    question: "Where do I find my classes?",
    answer:
      "Open the dashboard from the sidebar. Teachers manage created classes there, and students see classes they have joined.",
  },
];

const teacherFaq: HelpQA[] = [
  {
    question: "How do I publish AI learning activities?",
    answer:
      "Open a class, upload materials, generate a blueprint, review it, then create assignments for chat, quiz, or flashcards.",
  },
  {
    question: "How do students join my class?",
    answer:
      "Each class has a join code in the Enrollment section. Share that code with students so they can join from their dashboard.",
  },
  {
    question: "How do I monitor submissions?",
    answer:
      "Use assignment review pages and class activity sections to check completion status and submission quality.",
  },
];

const studentFaq: HelpQA[] = [
  {
    question: "How do I join a class?",
    answer:
      "Go to Join Class from the sidebar or dashboard, enter the join code provided by your teacher, and submit.",
  },
  {
    question: "How do I access AI chat and assignments?",
    answer:
      "Open a class and use the class widgets. If chat is locked, wait for your teacher to publish the blueprint.",
  },
  {
    question: "How do I know what is due?",
    answer:
      "Your dashboard shows current, upcoming, and completed work. Inside each class you can open each assignment directly.",
  },
];

export function getHelpContent(accountType: AccountType) {
  return {
    checklist:
      accountType === "teacher"
        ? [
            "Create a class and share join code with students.",
            "Upload materials and review processing status.",
            "Generate and curate blueprint before publishing.",
            "Create chat, quiz, and flashcards assignments.",
          ]
        : [
            "Join class using your teacher's code.",
            "Open class widgets to access chat and assignments.",
            "Track due and completed work from dashboard.",
            "Use published blueprint for guided revision.",
          ],
    faq: [...sharedFaq, ...(accountType === "teacher" ? teacherFaq : studentFaq)],
  };
}
