import { SignedXml } from 'xml-crypto';
import { type KeyObject, X509Certificate, randomUUID } from 'node:crypto';
import { X509Certificate as StructuredCertificate } from '@peculiar/x509';
import { SOAP, SAT, AUTH, type SatOperation } from './sat-contract';
const DS = 'http://www.w3.org/2000/09/xmldsig#',
  C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  EXC = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const WSSE =
    'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd',
  WSU =
    'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd';
export const escapeXml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!,
  );
export function signSatOperation(
  operation: Exclude<SatOperation, 'Autentica'>,
  attributes: Record<string, string>,
  key: KeyObject,
  cert: X509Certificate,
): string {
  const element =
    operation === 'PeticionDescargaMasivaTercerosEntrada'
      ? 'peticionDescarga'
      : 'solicitud';
  const structured = new StructuredCertificate(cert.raw);
  const keyInfo =
    '<X509Data><X509IssuerSerial><X509IssuerName>' +
    escapeXml(structured.issuer) +
    '</X509IssuerName><X509SerialNumber>' +
    BigInt('0x' + cert.serialNumber).toString() +
    '</X509SerialNumber></X509IssuerSerial><X509Certificate>' +
    cert.raw.toString('base64') +
    '</X509Certificate></X509Data>';
  const unsigned =
    '<' +
    element +
    ' xmlns="' +
    SAT +
    '" ' +
    Object.keys(attributes)
      .sort()
      .map((k) => {
        if (!/^[A-Za-z]+$/.test(k)) throw new Error('SAT_ATTRIBUTE_INVALID');
        return k + '="' + escapeXml(attributes[k]) + '"';
      })
      .join(' ') +
    '></' +
    element +
    '>';
  const signer = new SignedXml({
    privateKey: key,
    canonicalizationAlgorithm: C14N,
    signatureAlgorithm: DS + 'rsa-sha1',
    getKeyInfoContent: () => keyInfo,
  });
  signer.addReference({
    xpath: '/*',
    transforms: [DS + 'enveloped-signature', C14N],
    digestAlgorithm: DS + 'sha1',
    isEmptyUri: true,
  });
  signer.computeSignature(unsigned, {
    location: { reference: '/*', action: 'append' },
  });
  return (
    '<s:Envelope xmlns:s="' +
    SOAP +
    '"><s:Header/><s:Body><' +
    operation +
    ' xmlns="' +
    SAT +
    '">' +
    signer.getSignedXml() +
    '</' +
    operation +
    '></s:Body></s:Envelope>'
  );
}
export function signSatAuthentication(
  key: KeyObject,
  cert: X509Certificate,
  now: Date,
  expires: Date,
): string {
  if (expires <= now || expires.getTime() - now.getTime() > 300000)
    throw new Error('SAT_AUTH_WINDOW_INVALID');
  const id = 'uuid-' + randomUUID();
  const tokenType =
    'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3';
  const xml =
    '<s:Envelope xmlns:s="' +
    SOAP +
    '" xmlns:u="' +
    WSU +
    '"><s:Header><o:Security xmlns:o="' +
    WSSE +
    '" s:mustUnderstand="1"><u:Timestamp u:Id="_0"><u:Created>' +
    now.toISOString() +
    '</u:Created><u:Expires>' +
    expires.toISOString() +
    '</u:Expires></u:Timestamp><o:BinarySecurityToken u:Id="' +
    id +
    '" ValueType="' +
    tokenType +
    '" EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">' +
    cert.raw.toString('base64') +
    '</o:BinarySecurityToken></o:Security></s:Header><s:Body><Autentica xmlns="' +
    AUTH +
    '"/></s:Body></s:Envelope>';
  const signer = new SignedXml({
    privateKey: key,
    idMode: 'wssecurity',
    canonicalizationAlgorithm: EXC,
    signatureAlgorithm: DS + 'rsa-sha1',
    getKeyInfoContent: () =>
      '<o:SecurityTokenReference xmlns:o="' +
      WSSE +
      '"><o:Reference ValueType="' +
      tokenType +
      '" URI="#' +
      id +
      '"/></o:SecurityTokenReference>',
  });
  signer.addReference({
    xpath: "//*[local-name()='Timestamp']",
    transforms: [EXC],
    digestAlgorithm: DS + 'sha1',
  });
  signer.computeSignature(xml, {
    location: { reference: "//*[local-name()='Security']", action: 'append' },
  });
  return signer.getSignedXml();
}
