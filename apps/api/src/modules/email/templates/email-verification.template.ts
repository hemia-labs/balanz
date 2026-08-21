export interface EmailVerificationTemplateData {
  assetsBaseUrl: string;
  appName: string;
  appSubtitle: string;
  logoLetter: string;
  previewText: string;
  headline: string;
  greeting: string;
  bodyText: string;
  ctaLabel: string;
  fallbackText: string;
  verificationUrl: string;
  expirationText: string;
  unrequestedText: string;
  supportTitle: string;
  supportEmailPrefix: string;
  supportEmail: string;
  supportEmailLabel: string;
  supportHelpPrefix: string;
  helpUrl: string;
  helpLabel: string;
  footerDescription: string;
  privacyUrl: string;
  privacyLabel: string;
  termsUrl: string;
  termsLabel: string;
}

export const EMAIL_VERIFICATION_TEMPLATE = `
<mjml>
  <mj-head>
    <mj-title><%= headline %> · <%= appName %></mj-title>
    <mj-preview><%= previewText %></mj-preview>

    <mj-attributes>
      <mj-all font-family="Inter, Arial, Helvetica, sans-serif" />

      <mj-text
        color="#62747D"
        font-size="16px"
        line-height="1.55"
      />

      <mj-button
        font-family="Inter, Arial, Helvetica, sans-serif"
        font-weight="700"
      />
    </mj-attributes>
  </mj-head>

  <mj-body width="720px" background-color="#FFFFFF">
    <mj-section
      background-color="#F7FAF9"
      padding="0"
    >

      <!-- Logo PNG transparente -->
      <mj-column
        width="42%"
        vertical-align="middle"
        padding="30px 0 30px 36px"
      >
        <mj-image
          src="<%= assetsBaseUrl %>/email/projects/cfdi/logos/logo-v1.png"
          alt="<%= appName %> <%= appSubtitle %>"
          width="190px"
          align="left"
          padding="0"
        />
      </mj-column>

      <mj-column
        width="58%"
        vertical-align="bottom"
        padding="0"
      >
        <mj-image
          src="<%= assetsBaseUrl %>/email/projects/cfdi/headers/validate-email-v1.jpg"
          alt="Panel de administración contable"
          align="right"
          padding="0"
        />
      </mj-column>

    </mj-section>

    <mj-section padding="0">
      <mj-column>
        <mj-divider
          border-width="1px"
          border-color="#E2E8E5"
          padding="0"
        />
      </mj-column>
    </mj-section>

    <mj-section padding="34px 48px 0 48px">
      <mj-column>

        <mj-text
          color="#172831"
          font-size="34px"
          font-weight="800"
          line-height="1.15"
          padding="0 0 12px 0"
        >
          <%= headline %>
        </mj-text>

        <mj-text
          padding="0 0 28px 0"
          line-height="4px"
        >
          <span style="
            display:inline-block;
            width:48px;
            height:4px;
            background:#08737A;
            border-radius:4px;
          "></span>
        </mj-text>

        <mj-text
          color="#08737A"
          font-size="18px"
          font-weight="700"
          padding="0 0 6px 0"
        >
          <%= greeting %>
        </mj-text>

        <mj-text
          color="#596B74"
          font-size="17px"
          line-height="1.55"
          padding="0 0 30px 0"
        >
          <%= bodyText %>
        </mj-text>

        <mj-button
          href="<%= verificationUrl %>"
          background-color="#08737A"
          color="#FFFFFF"
          border-radius="9px"
          font-size="17px"
          font-weight="700"
          inner-padding="17px 58px"
          padding="0 0 32px 0"
        >
          <img
            src="<%= assetsBaseUrl %>/email/projects/cfdi/iconos/email-wt-v1.png"
            alt=""
            width="18"
            height="18"
            style="display:inline-block; width:18px; height:18px; margin-right:8px; vertical-align:middle;"
          />
          <%= ctaLabel %>
        </mj-button>

      </mj-column>
    </mj-section>

    <mj-section padding="0 48px 26px 48px">

      <mj-column
        background-color="#F6F8F7"
        border="1px solid #DCE4E0"
        border-radius="12px"
        padding="20px 22px"
      >

        <mj-text
          color="#70828A"
          font-size="14px"
          line-height="1.45"
          padding="0"
        >
          <table
            role="presentation"
            border="0"
            cellpadding="0"
            cellspacing="0"
            style="width:100%;"
          >
            <tr>
              <td
                width="74"
                valign="top"
                style="width:74px; padding:0 18px 0 0; vertical-align:top;"
              >
                <table
                  role="presentation"
                  border="0"
                  cellpadding="0"
                  cellspacing="0"
                  style="width:56px; height:56px;"
                >
                  <tr>
                    <td
                      width="56"
                      height="56"
                      align="center"
                      valign="middle"
                      style="width:56px; height:56px; background-color:#E6F1EE; border-radius:50%; text-align:center; vertical-align:middle;"
                    >
                      <img
                        src="<%= assetsBaseUrl %>/email/projects/cfdi/iconos/link-v2.png"
                        alt="Enlace de verificación"
                        width="30"
                        height="30"
                        style="display:inline-block; width:30px; height:30px; opacity:1; vertical-align:middle;"
                      />
                    </td>
                  </tr>
                </table>
              </td>
              <td valign="top" style="vertical-align:top;">
                <div style="color:#70828A; font-size:14px; line-height:1.45; padding:0 0 8px 0;">
                  <%= fallbackText %>
                </div>
                <a
                  href="<%= verificationUrl %>"
                  style="
                    color:#08737A;
                    font-size:14px;
                    font-weight:700;
                    line-height:1.5;
                    text-decoration:none;
                    word-break:break-all;
                  "
                >
                  <%= verificationUrl %>
                </a>
              </td>
            </tr>
          </table>
        </mj-text>

      </mj-column>

    </mj-section>

    <mj-section padding="0 48px 30px 48px">

      <mj-column
        width="10%"
        vertical-align="middle"
      >
        <mj-image
          src="<%= assetsBaseUrl %>/email/projects/cfdi/iconos/security-v2.png"
          alt="Seguridad"
          width="50px"
          padding="0"
        />
      </mj-column>

      <mj-column
        width="90%"
        vertical-align="middle"
        padding="0 0 0 12px"
      >

        <mj-text
          color="#08737A"
          font-size="15px"
          font-weight="700"
          padding="0 0 3px 0"
        >
          <%= expirationText %>
        </mj-text>

        <mj-text
          color="#70818A"
          font-size="14px"
          padding="0"
        >
          <%= unrequestedText %>
        </mj-text>

      </mj-column>

    </mj-section>
    
    <mj-section padding="0">
      <mj-column padding="0">

        <mj-divider
          border-width="1px"
          border-color="#DDE5E2"
          padding="0"
        />

      </mj-column>
    </mj-section>


    <mj-section padding="26px 48px">

      <mj-column
        width="30%"
        vertical-align="middle"
        padding="0 22px 0 0"
      >
        <mj-image
          src="<%= assetsBaseUrl %>/email/projects/cfdi/logos/logo-v1.png"
          alt="<%= appName %> <%= appSubtitle %>"
          width="145px"
          align="left"
          padding="0"
        />
      </mj-column>


      <mj-column
        width="70%"
        vertical-align="middle"
        border-left="1px solid #DDE5E2"
        padding="2px 0 2px 26px"
      >

        <mj-text
          color="#172831"
          font-size="14px"
          font-weight="600"
          padding="0 0 7px 0"
        >
          <%= footerDescription %>
        </mj-text>

        <mj-text
          color="#778991"
          font-size="13px"
          padding="0"
        >
          Av. Reforma 123, Ciudad de México, México
        </mj-text>

      </mj-column>

    </mj-section>

    <mj-section
      background-color="#EEF6F4"
      padding="14px 40px"
    >

      <mj-column
        width="64px"
        vertical-align="middle"
        padding="0"
      >

        <mj-image
          src="<%= assetsBaseUrl %>/email/projects/cfdi/iconos/lock-v1.png"
          alt="Seguridad"
          width="24px"
          align="left"
          padding="0"
        />

      </mj-column>

      <mj-column
        width="576px"
        vertical-align="middle"
        padding="0"
      >

        <mj-text
          align="left"
          color="#668087"
          font-size="12px"
          line-height="1.5"
          padding="0"
        >
          Recibiste este correo porque alguien usó esta dirección
          para registrarse en <%= appName %>.
        </mj-text>

      </mj-column>

    </mj-section>

  </mj-body>
</mjml>`;
