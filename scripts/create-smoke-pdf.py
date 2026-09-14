import sys

out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/smoke.pdf'
objects = [
    b'1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    b'2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    b'3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    b'4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n',
]
stream = b'q\n0 0 0 rg\n100 500 412 180 re\nf\nQ\nBT\n/F1 30 Tf\n1 1 1 rg\n150 580 Td\n(SMOKE PDF OK) Tj\nET\n'
objects.append(b'5 0 obj\n<< /Length %d >>\nstream\n' % len(stream) + stream + b'endstream\nendobj\n')
pdf = b'%PDF-1.4\n'
offsets = [0]
for obj in objects:
    offsets.append(len(pdf))
    pdf += obj
xref = len(pdf)
pdf += b'xref\n0 6\n0000000000 65535 f \n'
for off in offsets[1:]:
    pdf += f'{off:010d} 00000 n \n'.encode()
pdf += b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + str(xref).encode() + b'\n%%EOF\n'
with open(out, 'wb') as f:
    f.write(pdf)
print(f'Created {out} ({len(pdf)} bytes)')
