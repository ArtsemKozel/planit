import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  const { employeeName, startDate, endDate, days, managerEmail } = await req.json();

  const emailBody = `
Neuer Urlaubsantrag eingegangen:

Mitarbeiter: ${employeeName}
Von: ${startDate}
Bis: ${endDate}
Urlaubstage: ${days}

Bitte in PlanIt genehmigen oder ablehnen.
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "PlanIt <noreply@planit.de>",
      to: managerEmail,
      subject: `Urlaubsantrag: ${employeeName}`,
      text: emailBody,
    }),
  });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});