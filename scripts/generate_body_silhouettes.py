"""One-off script to generate realistic body silhouettes via Gemini Nano Banana."""

import asyncio
import base64
import os
from pathlib import Path

from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage

load_dotenv(Path(__file__).parent.parent / "backend" / ".env")

API_KEY = os.environ["EMERGENT_LLM_KEY"]
OUT_DIR = Path(__file__).parent.parent / "frontend" / "assets" / "body"
OUT_DIR.mkdir(parents=True, exist_ok=True)


PROMPT_MALE = (
    "A clean, realistic anatomical illustration of a full-body male human silhouette, "
    "front-facing pose, arms slightly out from the body (like a fitness measurement pose), "
    "athletic proportions with visible chest, waist, hips and thighs. "
    "Fill in solid mint green color (#10B981) with darker outline. "
    "Simple, flat, minimal medical infographic style. "
    "Person is standing straight, feet slightly apart, head visible. "
    "Pure white background. Centered composition, full body from head to toes visible with a small margin. "
    "No text, no labels, no shadows, no clothing. Professional fitness app illustration style. "
    "Vertical portrait orientation, aspect ratio 1:2."
)

PROMPT_FEMALE = (
    "A clean, realistic anatomical illustration of a full-body female human silhouette, "
    "front-facing pose, arms slightly out from the body (like a fitness measurement pose), "
    "athletic hourglass proportions with narrow waist and wider hips. "
    "Fill in solid mint green color (#10B981) with darker outline. "
    "Simple, flat, minimal medical infographic style. "
    "Person is standing straight, feet slightly apart, head visible. "
    "Pure white background. Centered composition, full body from head to toes visible with a small margin. "
    "No text, no labels, no shadows, no clothing. Professional fitness app illustration style. "
    "Vertical portrait orientation, aspect ratio 1:2."
)


async def gen(prompt: str, filename: str):
    chat = LlmChat(
        api_key=API_KEY,
        session_id=f"body-silhouette-{filename}",
        system_message="You produce clean anatomical silhouette illustrations for fitness apps.",
    ).with_model("gemini", "gemini-3.1-flash-image-preview").with_params(modalities=["image", "text"])
    text, images = await chat.send_message_multimodal_response(UserMessage(text=prompt))
    print(f"[{filename}] text len:", len(text or ""), "images:", len(images or []))
    if not images:
        raise RuntimeError(f"No image returned for {filename}")
    img = images[0]
    out_path = OUT_DIR / filename
    with open(out_path, "wb") as f:
        f.write(base64.b64decode(img["data"]))
    print(f"[{filename}] saved -> {out_path} ({out_path.stat().st_size} bytes)")


async def main():
    await gen(PROMPT_MALE, "male.png")
    await gen(PROMPT_FEMALE, "female.png")


if __name__ == "__main__":
    asyncio.run(main())
